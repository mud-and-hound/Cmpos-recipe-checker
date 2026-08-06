# -*- coding: utf-8 -*-
"""
app.py — CM POS Recipe Checker
เว็บสำหรับ "เช็ค" อย่างเดียว (read-only ทั้งฝั่ง DB และไฟล์ Excel) — การแก้ไขจริงยังคงทำผ่านหน้า CM POS
(มือกรอกเอง หรือ copy ไปวางใน Tampermonkey BOM Recipe Add Helper ที่มีอยู่แล้ว)

รันแบบ dev server:
    python app.py
แล้วเปิด http://localhost:5000  (ต้องรันบนเครื่อง/เซิร์ฟเวอร์ที่เข้าถึง 10.8.1.88 ได้ทาง network เดียวกัน)
"""
import os
import uuid
import tempfile

from dotenv import load_dotenv
load_dotenv()  # อ่านค่าจาก .env ถ้ามี (ไม่ error ถ้าไม่มีไฟล์)

from flask import Flask, render_template, request, redirect, url_for, session, jsonify, send_file

from recipe_parser import parse_all
from compare_engine import evaluate_all, group_by_parent, to_tampermonkey_text, STATUS_GREEN
import db_helper

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-only-change-me")
app.config["MAX_CONTENT_LENGTH"] = 60 * 1024 * 1024  # 60MB รวมทั้ง 3 ไฟล์

# เก็บผลลัพธ์ล่าสุดไว้ใน memory ต่อ session id ง่ายๆ (โปรเจกต์เล็ก ไม่จำเป็นต้องมี DB เก็บ session)
RESULTS_STORE = {}


@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")


@app.route("/upload", methods=["POST"])
def upload():
    labels = ["Food", "Beverage", "Dessert"]
    saved_files = []
    tmp_dir = tempfile.mkdtemp(prefix="cmpos_upload_")
    for label in labels:
        f = request.files.get(f"file_{label.lower()}")
        if f and f.filename:
            path = os.path.join(tmp_dir, f"{label}.xlsx")
            f.save(path)
            saved_files.append((path, label))

    if not saved_files:
        return render_template("index.html", error="กรุณาอัปโหลดไฟล์อย่างน้อย 1 ไฟล์")

    # 1) Parse Excel ทั้งหมด
    try:
        rows, ingredients_lookup = parse_all(saved_files)
    except Exception as e:
        return render_template("index.html", error=f"อ่านไฟล์ Excel ไม่สำเร็จ: {e}")

    if not rows:
        return render_template("index.html", error="ไม่พบข้อมูล Recipe ในไฟล์ที่อัปโหลด (เช็คว่าไฟล์มีชีท Recipe_xxx / xxx_Branch ไหม)")

    # 2) ดึงข้อมูลจาก DB (read-only)
    item_codes = set(r["ingredient_code"] for r in rows) | set(r["parent_code"] for r in rows)
    try:
        conn = db_helper.get_connection()
        item_mast_lookup = db_helper.fetch_item_mast(conn, item_codes)
        unit_conv_lookup = db_helper.fetch_unit_conv(conn, item_codes)
        conn.close()
    except Exception as e:
        return render_template(
            "index.html",
            error=("เชื่อมต่อ MySQL ไม่สำเร็จ — เช็ค DB_HOST/DB_USER/DB_PASSWORD ใน environment variable "
                   f"(ดู README.md) รายละเอียด error: {e}")
        )

    # 3) เทียบ + จัดกลุ่ม
    evaluated = evaluate_all(rows, item_mast_lookup, unit_conv_lookup, ingredients_lookup)
    groups = group_by_parent(evaluated)
    groups.sort(key=lambda g: (-g["worst_status"], g["parent_code"] or ""))

    # สรุปตัวเลขรวม
    summary = {"total_rows": len(evaluated), "total_groups": len(groups)}
    for st in ["green", "yellow", "orange", "red", "missing"]:
        summary[st] = sum(1 for r in evaluated if r["status"] == st)

    result_id = str(uuid.uuid4())
    RESULTS_STORE[result_id] = {"groups": groups, "summary": summary}
    session["result_id"] = result_id
    return redirect(url_for("results"))


@app.route("/results")
def results():
    result_id = session.get("result_id")
    data = RESULTS_STORE.get(result_id)
    if not data:
        return redirect(url_for("index"))
    filter_status = request.args.get("status", "all")
    groups = data["groups"]
    if filter_status != "all":
        groups = [g for g in groups if any(r["status"] == filter_status for r in g["rows"])]
    return render_template("results.html", groups=groups, summary=data["summary"], filter_status=filter_status)


@app.route("/api/group_text/<recipe_type>/<parent_code>")
def api_group_text(recipe_type, parent_code):
    result_id = session.get("result_id")
    data = RESULTS_STORE.get(result_id)
    if not data:
        return jsonify({"error": "session หมดอายุ กรุณาอัปโหลดใหม่"}), 404
    for g in data["groups"]:
        if g["recipe_type"] == recipe_type and g["parent_code"] == parent_code:
            return jsonify({"text": to_tampermonkey_text(g)})
    return jsonify({"error": "ไม่พบกลุ่มนี้"}), 404


@app.route("/export.csv")
def export_csv():
    import csv
    import io
    result_id = session.get("result_id")
    data = RESULTS_STORE.get(result_id)
    if not data:
        return redirect(url_for("index"))

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["recipe_type", "parent_code", "parent_name", "source_file", "sheet",
                      "ingredient_code", "ingredient_desc_excel", "ingredient_name_db",
                      "excel_qty", "excel_unit", "final_qty", "final_unit", "status", "note"])
    for g in data["groups"]:
        for r in g["rows"]:
            writer.writerow([
                r["recipe_type"], r["parent_code"], r["parent_name"], r["source_file"], r["sheet"],
                r["ingredient_code"], r["ingredient_desc"], r.get("item_name_db"),
                r["excel_qty"], r["excel_unit_raw"], r["final_qty"], r["final_unit"], r["status"], r["note"],
            ])
    buf.seek(0)
    byte_buf = io.BytesIO(buf.getvalue().encode("utf-8-sig"))  # utf-8-sig กัน Excel เปิดแล้วภาษาไทยเพี้ยน
    return send_file(byte_buf, mimetype="text/csv", as_attachment=True,
                      download_name="cmpos_recipe_check_result.csv")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
