# CM POS Recipe Checker

เว็บเช็ค RM/WIP + หน่วย/จำนวน ในไฟล์ Recipe (Food/Beverage/Dessert) เทียบกับข้อมูลจริงใน CM POS
ก่อนกรอกเข้าระบบ (ผ่านมือ หรือผ่าน Tampermonkey BOM Recipe Add Helper)

**เว็บนี้อ่านอย่างเดียว (read-only)** ทั้งไฟล์ Excel และฐานข้อมูล MySQL — ไม่มีการ
INSERT/UPDATE/DELETE ใดๆ กลับเข้า DB เลย การกรอกข้อมูลจริงยังทำผ่านหน้า CM POS ตามปกติ

---

## 1) เตรียมเครื่อง

ต้องรันบนเครื่อง/เซิร์ฟเวอร์ที่อยู่ใน network เดียวกับ `10.8.1.88` (วง LAN ของร้าน) เพราะเว็บนี้
ต่อ MySQL ไปที่ IP นั้นตรงๆ — รันจากเครื่องนอก LAN จะต่อ DB ไม่ติด

ต้องมี Python 3.9+ ติดตั้งไว้ก่อน

```bash
cd cmpos-recipe-checker
pip install -r requirements.txt
```

## 2) ตั้งค่า DB credential

คัดลอก `.env.example` เป็น `.env` แล้วกรอกค่าจริง (ไฟล์ `.env` ถูก `.gitignore` ไว้แล้ว จะไม่ขึ้น GitHub):

```bash
cp .env.example .env
# แล้วแก้ .env ด้วย text editor ใส่ DB_USER / DB_PASSWORD จริง
```

หรือจะตั้งผ่าน environment variable ตรงๆ ก็ได้ (ไม่ต้องใช้ .env):

**Windows (PowerShell):**
```powershell
$env:DB_HOST="10.8.1.88"
$env:DB_USER="ชื่อ user ของเต้"
$env:DB_PASSWORD="รหัสผ่านของเต้"
$env:DB_NAME="gh_promotion"
```

**Mac/Linux:**
```bash
export DB_HOST=10.8.1.88 DB_USER=ชื่อuser DB_PASSWORD=รหัสผ่าน DB_NAME=gh_promotion
```

## 3) รันเว็บ

```bash
python app.py
```

เปิดเบราว์เซอร์ไปที่ `http://localhost:5000` (หรือ `http://<IP เครื่องที่รัน>:5000` ถ้าอยากเปิดจากเครื่องอื่นในวง LAN)

## 4) ใช้งาน

1. อัปโหลดไฟล์ Recipe (Food/Beverage/Dessert) — อัปโหลดกี่ไฟล์ก็ได้ ไม่ต้องครบ 3
2. กด "อัปโหลด + เช็คเลย"
3. ดูผลลัพธ์แยกตามเมนู/สูตร พร้อมสถานะสี — กด "Copy สำหรับ Tampermonkey" ที่เมนูไหนก็ได้
   จะได้ text รูปแบบ `code[Tab]amount[Tab]unit` พร้อมวางใน BOM Recipe Add Helper ทันที
4. Export CSV ทั้งหมดได้ถ้าอยากเปิดใน Excel เพื่อรีวิวเป็นชุด

---

## Logic การเทียบหน่วย (สรุปจากที่คุยกันในแชท)

| Tier | สี | เงื่อนไข | ความมั่นใจ |
|---|---|---|---|
| 1 | 🟢 เขียว | หน่วยที่ไฟล์ระบุ ตรงกับแถวใน `unit_conv_tb` พอดี | สูงสุด — ใช้ `conv_fact` จาก DB ตรงๆ |
| 2 | 🟡 เหลือง | ไม่ตรง แต่มีหน่วยพี่น้องในกลุ่ม GR/ML/KG/LT ให้ใช้ (GR=ML 1:1, KG=LT 1:1, ข้ามกลุ่ม x/÷1000) | สูง แต่ควรเช็คซ้ำ |
| 3 | 🟠 ส้ม | ไม่เจอใน `unit_conv_tb` เลย แต่ชีท `Ingredients` ในไฟล์ Excel เองมีสูตร (`#RU per PU`) | ปานกลาง — หน่วยปลายทางเดาเป็น `PCS` เสมอ (ไม่ยืนยัน 100%) |
| 4 | 🔴 แดง | ไม่เจอที่ไหนเลย | ต่ำ — โชว์ค่าดิบจากไฟล์ให้ดูก่อน (ตามที่ตกลง "flag แดง + ลองคำนวณให้ดูก่อน") ต้องเช็คมือ |
| — | ⚪ เทา | ไม่พบรหัสนี้ใน `ItemMast` เลย | เช็ครหัสผิด/ถูกยกเลิกไปแล้ว |

**หมายเหตุสำคัญที่ยืนยันกับผู้ใช้แล้วระหว่างคุยกัน:**
- `ml = g` และ `kg = ltr` เป็น business rule ของ CM POS เอง (ไม่ใช่ฟิสิกส์จริง)
- ตาราง `unit_conv_tb` (10,205 แถว) เป็นแหล่งข้อมูลหลัก แต่**ไม่ครบ 100%** (พบเคส `NCGB11001` ที่ควรมีแถว ML แต่ไม่มี) — เพราะงั้น Tier 2/3/4 ยังจำเป็น
- คอลัมน์ `PU U/M` ในชีท `Ingredients` ของ Excel เป็นแค่ "คำอธิบาย" (เช่น "Gallon") ไม่ใช่โค้ดหน่วยจริงของ CM POS เสมอไป — Tier 3 จึงเดาเป็น `PCS` และ flag ให้เช็คมือ
- ตาราง `recipe_master_tb` / `recipe_line_tb` **ไม่ได้ใช้** ในเวอร์ชันนี้ เพราะข้อมูลไม่ครบ (มีแค่ 6 recipe) และไม่ทราบที่มาแน่ชัด — เก็บไว้เป็นแนวทางเสริมในอนาคตถ้าข้อมูลสมบูรณ์ขึ้น

## โครงสร้างไฟล์

```
app.py              Flask routes หลัก (upload / results / export / copy API)
recipe_parser.py     อ่าน Excel 3 ไฟล์ แยกชีท FG_RECIPE / WIP_RECIPE / INGREDIENTS อัตโนมัติ
db_helper.py          ต่อ MySQL + query ItemMast/unit_conv_tb แบบ batch (read-only)
compare_engine.py    logic เทียบ/แปลงหน่วย 4 ชั้น
unit_utils.py         normalize ข้อความหน่วย + สูตรแปลงกลุ่ม GR/ML/KG/LT
templates/           หน้าเว็บ (index.html = อัปโหลด, results.html = ผลลัพธ์)
static/style.css     ธีมสีเดียวกับ Tampermonkey Helper เดิม (ม่วง/เขียว, ฟอนต์ Sarabun)
```

## ทดสอบแล้วกับไฟล์จริง

Parser ทดสอบรันจริงกับไฟล์ Food/Beverage/Dessert 3 ไฟล์ที่ส่งมาแล้ว — parse ได้ 6,370 ingredient
rows, 850 รหัสในชีท Ingredients ครบทุก sheet pattern ที่เจอ (`Recipe_xxx`, `xxx_Branch`, `WIP_xxx`,
`เสร็จ-Recipe xxx`) และ logic เทียบหน่วยทดสอบแล้วว่าคำนวณ `15 ml ÷ 5000 = 0.003 PCS` ได้ตรงกับที่คำนวณมือไว้

**สิ่งที่ยังไม่ได้ทดสอบ (เพราะไม่มีสิทธิ์เข้า 10.8.1.88 จากสภาพแวดล้อมนี้):** การเชื่อมต่อ MySQL จริง
— ควรลองรันกับข้อมูลจริงชุดเล็กๆ ก่อน (เช่นไฟล์ Beverage อย่างเดียว) แล้วดูว่าผลลัพธ์ตรงกับที่คาดไว้ไหม
ก่อนใช้งานเต็มรูปแบบ

## ขั้นต่อไปที่แนะนำ

1. รันจริงกับ DB แล้วดูว่า error handling ครบไหม (เช่น connection timeout, permission denied)
2. เช็คว่า Tier 3 (fallback จาก Ingredients sheet) แม่นแค่ไหนกับข้อมูลจริงเยอะๆ — ถ้าแม่นดีอาจเลื่อนไปเป็น Tier 2
3. ถ้าอยากรองรับ WIP Recipe Validator (ที่มีอยู่แล้ว) ด้วย อาจต้องคุยกันต่อว่า format การ export ต่างกันไหม

---

## ขึ้น GitHub

โฟลเดอร์นี้เตรียม `.gitignore` + `.env.example` ให้พร้อมแล้ว (กัน password หลุดขึ้น public repo)
ก่อน push เช็คให้แน่ใจว่า **ไม่มีไฟล์ `.env` จริง หรือไฟล์ `.xlsx` ของบริษัทติดไปด้วย**

### วิธีที่ 1 — ผ่าน Git command line (แนะนำ)

```bash
cd cmpos-recipe-checker
git init
git add .
git status          # เช็คก่อนว่าไม่มี .env หรือไฟล์ .xlsx ติดไปในลิสต์
git commit -m "Initial commit: CM POS Recipe Checker"
git branch -M main
git remote add origin https://github.com/<username>/<repo-name>.git
git push -u origin main
```

### วิธีที่ 2 — ผ่านหน้าเว็บ GitHub (ไม่ต้องลง Git ในเครื่อง)

1. สร้าง repo เปล่าใหม่บน github.com (อย่าติ๊ก "Add README" ถ้าจะอัปโหลดทับ)
2. เข้าหน้า repo → **Add file → Upload files**
3. **ลากทั้งโฟลเดอร์ `cmpos-recipe-checker`** วางลงในหน้านั้นได้เลย (Chrome/Edge รองรับลากทั้งโฟลเดอร์ รักษาโครง subfolder เช่น `templates/`, `static/` ให้อัตโนมัติ)
4. เลื่อนลงล่างกด **Commit changes**

⚠️ **GitHub ไม่รับไฟล์ `.zip` เป็น repo โดยตรง** — ถ้าอัปโหลดไฟล์ zip ไป มันจะเก็บเป็น "ไฟล์ zip 1 ไฟล์" ไม่ใช่ extract เป็นโปรเจกต์ ต้องแตกไฟล์ zip ในเครื่องก่อน แล้วลากโฟลเดอร์ที่แตกแล้วขึ้นแทน (หรือใช้วิธีที่ 1)

ไฟล์ zip ที่แนบมาด้วยในข้อความนี้คือไว้ให้ดาวน์โหลด/แตกไฟล์ในเครื่องเต้เท่านั้น ไม่ใช่ไฟล์ที่จะอัปโหลดขึ้น GitHub ตรงๆ
