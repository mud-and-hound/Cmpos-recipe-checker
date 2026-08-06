# -*- coding: utf-8 -*-
"""
unit_utils.py
หน้าที่: normalize ข้อความหน่วย (ที่เขียนไม่คงที่ในไฟล์ Excel) ให้เป็นโค้ดหน่วยมาตรฐานของ CM POS
และให้สูตรแปลงหน่วย "กลุ่มชั่ง/ตวง" แบบ generic (GR<->ML<->KG<->LT)

อ้างอิง business rule ที่ยืนยันกับผู้ใช้แล้ว:
  - ml = g   (1:1 ตามกฎธุรกิจของ CM POS ไม่ใช่ความจริงทางฟิสิกส์)
  - KG = LT  (1:1 เช่นกัน)
  - ระหว่าง 2 กลุ่มนี้ ห่างกัน 1000 เท่า (หน่วยเล็ก -> ใหญ่ = หาร 1000)
"""

# แปลงข้อความหน่วยที่หลากหลายในไฟล์ Excel -> โค้ดหน่วยมาตรฐาน (ตรงกับ UnitTB ที่ user ส่งมา)
UNIT_ALIAS = {
    "g.": "GR", "g": "GR", "gr": "GR", "gr.": "GR", "gram": "GR", "grams": "GR", "กรัม": "GR",
    "kg": "KG", "kg.": "KG", "kilo": "KG", "kilogram": "KG", "กิโลกรัม": "KG", "กก": "KG", "กก.": "KG",
    "ml": "ML", "ml.": "ML", "milliliter": "ML", "มล": "ML", "มล.": "ML", "มิลลิลิตร": "ML",
    "l": "LT", "l.": "LT", "lt": "LT", "lt.": "LT", "ltr": "LT", "ltr.": "LT",
    "liter": "LT", "litre": "LT", "ลิตร": "LT",
    "pcs": "PCS", "pc": "PCS", "piece": "PCS", "pieces": "PCS", "ชิ้น": "PCS", "อัน": "PCS",
    "box": "BOX", "กล่อง": "BOX",
    "can": "CAN", "cans": "CAN", "กระป๋อง": "CAN",
    "bag": "BAG", "ถุง": "BAG",
    "bot": "BO", "bottle": "BO", "btl": "BTL", "ขวด": "BO",
    "cas": "CAS", "case": "CAS", "ลัง": "CAS",
    "pk": "PK", "pack": "PK", "แพ็ค": "PK", "แพค": "PK",
    "ea": "EA", "each": "EA",
    "bat": "BAT", "batch": "BAT", "สูตร": "BAT",
    "unit": "UNIT", "หน่วย": "UNIT",
    "gal": "GA", "gallon": "GA", "แกลลอน": "GA",
    "dz": "DZ", "dozen": "DZ", "โหล": "DZ",
    "set": "SET", "ชุด": "SET",
    "sheet": "SHEET", "แผ่น": "SHEET",
    "roll": "ROLL", "แถว": "ROLL",
    "slice": "SLICE", "สไลด์": "SLICE",
    "stick": "STICK", "แท่ง": "STICK",
    "cup": "CUP", "ถ้วย": "CUP",
    "sack": "SACK", "กระสอบ": "SACK",
    "leaf": "LEAF", "ใบ": "LEAF",
    "pail": "PAIL", "ปิ๊บ": "PAIL",
    "tank": "TANK", "ถัง": "TANK",
    "carton": "CT", "ct": "CT", "กล่องกระดาษ": "CT",
    "oz": "OZ",
}

# กลุ่มหน่วยชั่ง/ตวงที่แปลงกันได้ด้วยสูตรตายตัว (GR=ML=1:1, KG=LT=1:1, ข้ามกลุ่ม x/รหาร 1000)
WEIGHT_VOLUME_GROUP = {"GR", "ML", "KG", "LT"}
SMALL_UNITS = {"GR", "ML"}
LARGE_UNITS = {"KG", "LT"}


def normalize_unit(raw: str) -> str:
    """แปลงข้อความหน่วยดิบ (จากไฟล์ Excel) ให้เป็นโค้ดหน่วยมาตรฐาน"""
    if not raw:
        return ""
    key = str(raw).strip().lower()
    if key in UNIT_ALIAS:
        return UNIT_ALIAS[key]
    # ลอง strip จุด/วงเล็บท้าย เช่น "ml." "g." ออกก่อนเทียบอีกที
    key2 = key.rstrip(".").strip()
    if key2 in UNIT_ALIAS:
        return UNIT_ALIAS[key2]
    return str(raw).strip().upper()


def generic_weight_volume_convert(amount: float, from_unit: str, to_unit: str):
    """
    แปลงหน่วยในกลุ่มชั่ง/ตวง (GR/ML/KG/LT) แบบ generic
    คืนค่า (converted_amount, ok) — ok=False ถ้าแปลงไม่ได้ (ไม่อยู่ในกลุ่มนี้ หรือหน่วยเดียวกันอยู่แล้ว)
    """
    if from_unit == to_unit:
        return amount, True
    if from_unit not in WEIGHT_VOLUME_GROUP or to_unit not in WEIGHT_VOLUME_GROUP:
        return None, False

    if from_unit in SMALL_UNITS and to_unit in SMALL_UNITS:
        return amount, True  # GR <-> ML คือ 1:1
    if from_unit in LARGE_UNITS and to_unit in LARGE_UNITS:
        return amount, True  # KG <-> LT คือ 1:1
    if from_unit in SMALL_UNITS and to_unit in LARGE_UNITS:
        return amount / 1000.0, True  # เล็ก -> ใหญ่ หาร 1000
    if from_unit in LARGE_UNITS and to_unit in SMALL_UNITS:
        return amount * 1000.0, True  # ใหญ่ -> เล็ก คูณ 1000
    return None, False
