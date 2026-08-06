# -*- coding: utf-8 -*-
"""
compare_engine.py
หัวใจของระบบ — เทียบแต่ละ ingredient row จากไฟล์ Excel กับข้อมูลจริงใน CM POS (ItemMast + unit_conv_tb)
แล้วตัดสินว่าค่า (qty, unit) ที่จะกรอกเข้า CM POS ควรเป็นเท่าไหร่ พร้อมระดับความมั่นใจ

ลำดับชั้นการเช็ค (ตกลงกับผู้ใช้แล้ว):
  TIER 1 (เขียว)  : unit_conv_tb มีแถวตรงกับ (item_code, with_unit=หน่วยในไฟล์) พอดี -> ใช้ค่าจากไฟล์ได้เลย
  TIER 2 (เหลือง) : unit_conv_tb ไม่มีหน่วยที่ไฟล์ระบุ แต่มีหน่วยพี่น้องในกลุ่ม GR/ML/KG/LT -> แปลงให้อัตโนมัติ
  TIER 3 (ส้ม)    : ไม่เจอใน unit_conv_tb เลย แต่ชีท "Ingredients" ของไฟล์ Excel เองมีสูตร (#RU per PU) -> คำนวณ fallback
  TIER 4 (แดง)    : ไม่เจอที่ไหนเลย -> Flag แดงเด่นชัด + โชว์ค่าที่พยายามคำนวณให้ดูก่อน (ตามที่ตกลงกัน) ให้เช็คมือ
"""
from unit_utils import normalize_unit, generic_weight_volume_convert, WEIGHT_VOLUME_GROUP

STATUS_GREEN = "green"     # ตรงกับ DB เป๊ะ ใช้ได้เลย
STATUS_YELLOW = "yellow"   # แปลงอัตโนมัติในกลุ่มชั่ง/ตวง (GR/ML/KG/LT) มั่นใจสูง
STATUS_ORANGE = "orange"   # fallback จากชีท Ingredients ของ Excel เอง มั่นใจปานกลาง
STATUS_RED = "red"         # ไม่พบข้อมูลอ้างอิงเลย ต้องเช็คมือ
STATUS_MISSING = "missing" # ไม่พบ item code นี้ใน ItemMast เลย (ของหนักสุด)


def _find_conv_row(conv_list, with_unit):
    for r in conv_list:
        if r["with_unit"].strip().upper() == with_unit:
            return r
    return None


def _find_sibling_group_row(conv_list):
    """หาแถวไหนก็ได้ใน unit_conv_tb ของ item นี้ ที่ with_unit อยู่ในกลุ่ม GR/ML/KG/LT"""
    for r in conv_list:
        wu = r["with_unit"].strip().upper()
        if wu in WEIGHT_VOLUME_GROUP:
            return r
    return None


def evaluate_row(row, item_mast_lookup, unit_conv_lookup, ingredients_lookup):
    """
    row: 1 แถว ingredient จาก recipe_parser
    คืน dict ผลลัพธ์พร้อม status, final_qty, final_unit, note
    """
    code = row["ingredient_code"]
    excel_qty = row["excel_qty"]
    excel_unit = row["excel_unit"]  # normalize แล้วจาก parser

    result = dict(row)
    result.update({
        "item_found": False,
        "item_name_db": None,
        "status": STATUS_RED,
        "final_qty": None,
        "final_unit": None,
        "note": "",
    })

    item = item_mast_lookup.get(code)
    if not item:
        result["status"] = STATUS_MISSING
        result["note"] = f"ไม่พบรหัส {code} ใน ItemMast — เช็คว่ารหัสถูกต้อง/ยังไม่ถูกยกเลิกไหม"
        return result

    result["item_found"] = True
    result["item_name_db"] = item.get("ItemDes1")

    conv_list = unit_conv_lookup.get(code, [])

    # ── TIER 1: ตรงเป๊ะกับ unit_conv_tb ────────────────────────────
    exact = _find_conv_row(conv_list, excel_unit)
    if exact:
        result["status"] = STATUS_GREEN
        result["final_qty"] = round(excel_qty, 6)
        result["final_unit"] = exact["from_unit"] if exact["with_unit"] == exact["from_unit"] else excel_unit
        # ถ้า with_unit != from_unit แปลว่าไฟล์ให้หน่วยแบบ "หน่วยวัด" (เช่น ML) ตรงกับที่ DB รู้จัก
        # แต่ช่องที่ต้องกรอกจริงใน CM POS คือ from_unit (เช่น PCS) ต้องคูณ conv_fact เสมอ
        if exact["with_unit"] != exact["from_unit"]:
            result["final_qty"] = round(excel_qty * float(exact["conv_fact"]), 6)
            result["final_unit"] = exact["from_unit"]
            result["note"] = (f"แปลงจาก {excel_qty} {excel_unit} -> "
                               f"{result['final_qty']} {result['final_unit']} "
                               f"(conv_fact={exact['conv_fact']} จาก unit_conv_tb)")
        else:
            result["note"] = "หน่วยตรงกับ CM POS อยู่แล้ว ใช้ค่าจากไฟล์ได้เลย"
        return result

    # ── TIER 2: มีหน่วยพี่น้องในกลุ่ม GR/ML/KG/LT ให้ใช้ ──────────
    sibling = _find_sibling_group_row(conv_list)
    if sibling and excel_unit in WEIGHT_VOLUME_GROUP:
        sib_unit = sibling["with_unit"].strip().upper()
        converted, ok = generic_weight_volume_convert(excel_qty, excel_unit, sib_unit)
        if ok:
            # แปลงจากหน่วยไฟล์ -> หน่วยที่ DB รู้จัก (sib_unit) แล้วค่อยคูณ conv_fact ต่อเป็นหน่วยกรอกจริง
            final_qty = converted
            final_unit = sib_unit
            if sibling["with_unit"] != sibling["from_unit"]:
                final_qty = round(converted * float(sibling["conv_fact"]), 6)
                final_unit = sibling["from_unit"]
            result["status"] = STATUS_YELLOW
            result["final_qty"] = round(final_qty, 6)
            result["final_unit"] = final_unit
            result["note"] = (f"ไฟล์ระบุ {excel_qty} {excel_unit} แต่ CM POS ไม่มีหน่วยนี้ "
                               f"— แปลงในกลุ่มชั่ง/ตวงเป็น {result['final_qty']} {result['final_unit']} "
                               f"(ตรวจสอบอีกรอบก่อนใช้จริง)")
            return result

    # ── TIER 3: fallback จากชีท Ingredients ของไฟล์เอง ────────────
    # หมายเหตุสำคัญ: คอลัมน์ "PU U/M" ในชีท Ingredients เป็นแค่ "คำอธิบาย" หน่วยซื้อ (เช่น "Gallon")
    # ไม่ใช่โค้ดหน่วยจริงที่ CM POS ใช้เสมอไป (พบเคส NCGB11001: PU U/M="Gallon" แต่ CM POS จริงใช้ "PCS")
    # ดังนั้น Tier นี้ "เดา" หน่วยเป็น PCS เสมอ (พบบ่อยที่สุดในทางปฏิบัติ) และ flag ให้เช็คมือชัดเจน
    ing = ingredients_lookup.get(code)
    if ing and ing.get("ru_per_pu"):
        ru_unit_norm = normalize_unit(ing.get("ru_unit"))
        if ru_unit_norm == excel_unit:
            yield_pct = ing.get("yield_pct") or 1.0
            try:
                final_qty = round(excel_qty / (ing["ru_per_pu"] * yield_pct), 6)
                pu_label = ing.get("pu_unit") or "?"
                result["status"] = STATUS_ORANGE
                result["final_qty"] = final_qty
                result["final_unit"] = "PCS"  # ค่าเดา — ไม่ยืนยัน 100%
                result["note"] = (f"ไม่พบใน unit_conv_tb — ใช้สูตรจากชีท Ingredients ของไฟล์เอง "
                                   f"({excel_qty} ÷ {ing['ru_per_pu']} = {final_qty}) "
                                   f"⚠️ หน่วยเดาเป็น PCS (ไฟล์เขียนว่า \"{pu_label}\") "
                                   f"ต้องเปิดหน้า CM POS เช็ค dropdown จริงก่อนยืนยัน")
                return result
            except ZeroDivisionError:
                pass

    # ── TIER 4: หาไม่เจอเลย — Flag แดง + พยายามคำนวณให้ดูก่อน ────
    result["status"] = STATUS_RED
    # ลองเดาแบบ generic group ให้ดูเฉยๆ (ไม่ยืนยันความถูกต้อง) ตามที่ตกลงกันไว้
    guess_qty, guess_unit = None, None
    if excel_unit in WEIGHT_VOLUME_GROUP:
        # ถ้า item เดิมทีไม่มีข้อมูลอะไรเลยใน DB ก็ได้แค่โชว์ค่าดิบจากไฟล์เป็น best-effort
        guess_qty, guess_unit = excel_qty, excel_unit
    result["final_qty"] = round(guess_qty, 6) if guess_qty is not None else excel_qty
    result["final_unit"] = guess_unit or excel_unit
    result["note"] = ("❌ ไม่พบข้อมูลอ้างอิงทั้งใน unit_conv_tb และชีท Ingredients — "
                       "ค่าที่โชว์คือค่าดิบจากไฟล์ Excel (ยังไม่ยืนยัน) ต้องเช็คมือก่อนกรอกเข้า CM POS")
    return result


def evaluate_all(rows, item_mast_lookup, unit_conv_lookup, ingredients_lookup):
    return [evaluate_row(r, item_mast_lookup, unit_conv_lookup, ingredients_lookup) for r in rows]


def group_by_parent(evaluated_rows):
    """จัดกลุ่มผลลัพธ์ตาม parent_code (FG หรือ WIP) เพื่อแสดงผล/export ทีละเมนู"""
    groups = {}
    for r in evaluated_rows:
        key = (r["recipe_type"], r["parent_code"])
        if key not in groups:
            groups[key] = {
                "recipe_type": r["recipe_type"],
                "parent_code": r["parent_code"],
                "parent_name": r["parent_name"],
                "source_file": r["source_file"],
                "sheet": r["sheet"],
                "batch_qty": r.get("batch_qty"),
                "batch_unit": r.get("batch_unit"),
                "rows": [],
            }
        groups[key]["rows"].append(r)
    # สรุป worst-status ต่อกลุ่ม เอาไว้ sort/filter
    order = {STATUS_MISSING: 4, STATUS_RED: 3, STATUS_ORANGE: 2, STATUS_YELLOW: 1, STATUS_GREEN: 0}
    for g in groups.values():
        g["worst_status"] = max((order.get(r["status"], 0) for r in g["rows"]), default=0)
    return list(groups.values())


def to_tampermonkey_text(group):
    """สร้างข้อความ format 'code[Tab]amount[Tab]unit' พร้อม copy ไปวางใน BOM Recipe Add Helper"""
    lines = []
    for r in group["rows"]:
        qty = r["final_qty"] if r["final_qty"] is not None else r["excel_qty"]
        unit = r["final_unit"] or r["excel_unit"]
        lines.append(f"{r['ingredient_code']}\t{qty}\t{unit}")
    return "\n".join(lines)
