# -*- coding: utf-8 -*-
"""
db_helper.py
เชื่อมต่อ MySQL (gh_promotion) ดึงข้อมูล ItemMast + unit_conv_tb แบบ batch (กันยิง query ทีละแถว 6000+ ครั้ง)

ต้องตั้งค่า connection ผ่าน environment variables (ดู README.md):
  DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
"""
import os
import pymysql
import pymysql.cursors


def get_connection():
    return pymysql.connect(
        host=os.environ.get("DB_HOST", "10.8.1.88"),
        port=int(os.environ.get("DB_PORT", "3306")),
        user=os.environ.get("DB_USER", ""),
        password=os.environ.get("DB_PASSWORD", ""),
        database=os.environ.get("DB_NAME", "gh_promotion"),
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=8,
        read_timeout=20,
    )


def _chunks(lst, size=500):
    for i in range(0, len(lst), size):
        yield lst[i:i + size]


def fetch_item_mast(conn, item_codes):
    """คืน dict: item_code -> {itemdes1, orderunit, stockunit, useunit, countunit, itemstat}
    (อ่านอย่างเดียว — ไม่มีการ UPDATE/DELETE ใดๆ ต่อ DB นี้เลย)"""
    out = {}
    codes = sorted(set(c for c in item_codes if c))
    with conn.cursor() as cur:
        for batch in _chunks(codes):
            placeholders = ",".join(["%s"] * len(batch))
            # ⚠️ ItemCode เป็น CHAR มี trailing space (ตามบทเรียนของรุ่นพี่ในเอกสาร handoff)
            # ต้อง TRIM ทั้งฝั่งคอลัมน์และค่าที่ค้นหา ไม่งั้น join/match พลาดเงียบๆ
            sql = f"""
                SELECT LTRIM(RTRIM(ItemCode)) AS ItemCode, ItemDes1, ItemDes2,
                       OrderUnit, StockUnit, UseUnit, CountUnit, ItemStat
                FROM ItemMast
                WHERE LTRIM(RTRIM(ItemCode)) IN ({placeholders})
            """
            cur.execute(sql, batch)
            for row in cur.fetchall():
                out[row["ItemCode"].strip().upper()] = row
    return out


def fetch_unit_conv(conn, item_codes):
    """คืน dict: item_code -> list ของ {with_unit, from_unit, multiplier, conv_fact}"""
    out = {}
    codes = sorted(set(c for c in item_codes if c))
    with conn.cursor() as cur:
        for batch in _chunks(codes):
            placeholders = ",".join(["%s"] * len(batch))
            sql = f"""
                SELECT LTRIM(RTRIM(item_code)) AS item_code, with_unit, from_unit, multiplier, conv_fact
                FROM unit_conv_tb
                WHERE LTRIM(RTRIM(item_code)) IN ({placeholders})
            """
            cur.execute(sql, batch)
            for row in cur.fetchall():
                code = row["item_code"].strip().upper()
                out.setdefault(code, []).append(row)
    return out


def fetch_recipe_tb(conn, parent_codes):
    """POS (FG) recipe ตัวจริงที่ sync มาจาก CM POS (IRecDet) — ใช้เทียบว่าของเดิมในระบบเป็นยังไง
    ก่อนจะอัปเดตด้วยค่าจากไฟล์ Excel ใหม่ (ยังไม่ยืนยัน schema คอลัมน์ —ต้องเช็ค Structure จริงก่อนใช้งาน)"""
    out = {}
    codes = sorted(set(c for c in parent_codes if c))
    with conn.cursor() as cur:
        for batch in _chunks(codes):
            placeholders = ",".join(["%s"] * len(batch))
            sql = f"""
                SELECT * FROM recipe_tb
                WHERE LTRIM(RTRIM(recipe_code)) IN ({placeholders})
            """
            cur.execute(sql, batch)
            for row in cur.fetchall():
                key = str(row.get("recipe_code", "")).strip().upper()
                out.setdefault(key, []).append(row)
    return out


def fetch_wip_recipe_tb(conn, parent_codes):
    """WIP recipe ตัวจริงที่ sync มาจาก CM POS (IWipTB + IWip1Det)
    (ยังไม่ยืนยัน schema คอลัมน์ — ต้องเช็ค Structure จริงก่อนใช้งาน)"""
    out = {}
    codes = sorted(set(c for c in parent_codes if c))
    with conn.cursor() as cur:
        for batch in _chunks(codes):
            placeholders = ",".join(["%s"] * len(batch))
            sql = f"""
                SELECT * FROM wip_recipe_tb
                WHERE LTRIM(RTRIM(wip_code)) IN ({placeholders})
            """
            cur.execute(sql, batch)
            for row in cur.fetchall():
                key = str(row.get("wip_code", "")).strip().upper()
                out.setdefault(key, []).append(row)
    return out
