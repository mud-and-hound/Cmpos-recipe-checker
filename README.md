# CM POS Recipe Checker — Frontend (GitHub Pages)

หน้าเว็บ static ล้วน (HTML/CSS/JS ไม่มี build step) — อัปโหลดขึ้น GitHub Pages ได้ทันที
เชื่อมกับ backend API แยกต่างหาก (โฟลเดอร์ `cmpos-recipe-api`)

## ก่อนใช้งาน — ต้องแก้ 2 บรรทัดนี้ก่อนเสมอ

เปิดไฟล์ `app.js` แก้ 2 บรรทัดบนสุด:

```js
const API_BASE = "http://10.8.1.88:9008";   // URL จริงของ backend (ดู README ฝั่ง api)
const API_KEY = "changeme2026";              // ต้องตรงกับ RECIPE_API_KEY ฝั่ง backend
```

## อัปโหลดขึ้น GitHub Pages

1. สร้าง repo บน GitHub (หรือใช้ repo เดิม)
2. Add file → Upload files → ลากไฟล์ `index.html`, `style.css`, `app.js` (3 ไฟล์นี้พอ ไม่ต้องมีโฟลเดอร์ย่อย)
3. Settings → Pages → Source เลือก branch `main` / folder `root` → Save
4. รอสักครู่ จะได้ URL แบบ `https://<username>.github.io/<repo>/`

## ⚠️ ข้อจำกัดสำคัญ

- ใช้งานได้เฉพาะตอนเบราว์เซอร์ (คนที่เปิดเว็บ) **อยู่ในวง LAN ร้าน หรือต่อ VPN ร้าน** เท่านั้น
  เพราะ backend อยู่ที่ IP วง LAน (`10.8.1.88`) เข้าจากอินเทอร์เน็ตทั่วไปไม่ได้
- ถ้าหน้าเว็บเป็น `https://` (GitHub Pages บังคับ) แต่ backend เป็น `http://` — เบราว์เซอร์อาจบล็อกการเชื่อมต่อ
  (Mixed Content) ดูวิธีแก้ใน README ฝั่ง `cmpos-recipe-api`

## โครงสร้างหน้าเว็บ

- **อัปโหลดไฟล์**: คลิกวงกลมไอคอน Food / Beverage / Dessert → เลือกไฟล์ .xlsx (จะเลือกกี่ไฟล์ก็ได้ ไม่ต้องครบ 3)
- กด **"เช็คกับ CM POS"** → ระบบอัปโหลด+เทียบให้อัตโนมัติ
- ผลลัพธ์แยกตามเมนู/สูตร มีสถานะสี พร้อมเหตุผล (แปลงด้วยสูตรไหนมา) ทุกแถว
- กด **"คัดลอกสำหรับ Tampermonkey"** ที่เมนูไหนก็ได้ → วางใน BOM Recipe Add Helper ได้ทันที
- กด **Export CSV** เพื่อดาวน์โหลดผลทั้งหมด

## ดีไซน์

ธีมกรมท่า-ทอง (navy + gold) มินิมอล ไม่มีกรอบสี่เหลี่ยมทึบ ใช้เส้นบางแทน
ปุ่มอัปโหลดเป็นวงกลมลอย ไอคอน SVG เส้นบาง กดแล้วกรอบทองค่อยๆ ปรากฏพร้อม glow กระพริบ
(กระพริบ 2 ครั้งในช่วง ~2 วิ แล้วเงียบ ~3 วิ วนซ้ำ) — เคารพ `prefers-reduced-motion` ให้อัตโนมัติ
