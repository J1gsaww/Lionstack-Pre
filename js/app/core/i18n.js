"use strict";
/*
 ============================================================
   BEDROOM APP — personal life-management board.
   Cleaned from the original "Jigsaw Workspace" back office: only
   the "ห้องนอน" (bedroom) room survives — a personal task board
   (Diary) plus free-text notes.

   Data layer: localStorage (for local testing). When the app is
   ready to go online, the load/save helpers below are the only
   thing that needs to point at Firebase instead — nothing else in
   this file talks to the storage layer directly.
   ============================================================ 

*/
/* --- js/app/core/i18n.js : I18N — app language (TH/EN) --- */
/* ============================================================
   I18N — app language (TH / EN). Static text is tagged in HTML with
   data-i18n / data-i18n-placeholder / data-i18n-title; dynamic text
   built in JS goes through t(key). Language is saved in localStorage
   and applied across the whole app.
   ============================================================ */
const LANG_STORAGE_KEY = 'app_lang_v1';
let currentLang = 'th';

const MONTHS = {
  th: ["","ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."],
  en: ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
};
function monthName(m){ return (MONTHS[currentLang] || MONTHS.th)[m]; }

const I18N = {
  th: {
    'login.title':'เข้าสู่ระบบ', 'login.submit':'เข้าสู่ระบบ',
    'login.hint':'เข้าสู่ระบบด้วยบัญชีเจ้าของร้าน',
    'sidebar.logout':'ออกจากระบบ',
    'task.crumb':'กระดานงาน', 'calendar.crumb':'ปฏิทินรวมกำหนดงานทั้งหมด',
    'note.crumb':'โน้ตอิสระ นึกอะไรออกก็จดไว้', 'setting.crumb':'ตั้งค่าแอป',
    'maincal.crumb':'ปฏิทินรวมกำหนดงานจากทุกห้อง', 'globalnote.crumb':'โน้ตรวม ไม่ผูกกับห้องใด',
    'nav.home':'หน้าหลัก', 'nav.maincal':'ปฏิทินรวม', 'nav.globalnote':'โน้ต', 'nav.notify':'การแจ้งเตือน',
    'nav.interface':'นำเข้า/ส่งออก', 'nav.setting':'ตั้งค่าแอป (แอดมิน)', 'nav.usersetting':'ธีม & ภาษา', 'nav.cat.inventory':'สินค้า & การขาย', 'nav.cat.org':'องค์กร', 'nav.cat.accounting':'บัญชี', 'nav.cat.hr':'จัดการพนักงาน', 'nav.cat.setting':'ตั้งค่า', 'nav.task':'งาน', 'nav.calendar':'ปฏิทิน', 'nav.note':'โน้ต',
    'ui.category':'หมวดหมู่', 'ui.status':'สถานะ', 'ui.board':'บอร์ด', 'ui.list':'รายการ', 'ui.completed':'เสร็จแล้ว', 'ui.email':'อีเมล', 'ui.password':'รหัสผ่าน',
    'home.crumb':'ภาพรวมงานทั้งหมด', 'home.cards':'การ์ด', 'home.noRoom':'ยังไม่ได้สร้างห้อง', 'home.noCards':'ยังไม่มีการ์ดในห้องนี้',
    'home.showRoom':'แสดงห้อง', 'home.byStatus':'สถานะ', 'home.byCategory':'หมวดหมู่',
    'home.today':'งานที่ต้องทำวันนี้', 'home.today.desc':'รวมงานที่ยังไม่เสร็จจากทุกห้องที่ถึงกำหนดวันนี้', 'home.today.empty':'วันนี้ไม่มีงานถึงกำหนด',
    'home.progress':'ความคืบหน้า', 'home.progress.desc':'สัดส่วนงานที่เสร็จสมบูรณ์เทียบกับงานที่ยังทำอยู่',
    'home.allRooms':'ทุกห้องรวมกัน', 'home.complete':'เสร็จแล้ว', 'home.inProgress':'กำลังทำ', 'home.total':'ทั้งหมด',
    'notify.crumb':'งานที่ใกล้ถึงกำหนดจากทุกห้อง', 'notify.empty':'ยังไม่มีงานที่ใกล้ถึงกำหนด',
    'notify.page.hint':'แสดงงานที่ยังไม่เสร็จและจะถึงกำหนดภายใน {t} (การ์ดที่ตั้งค่าเองจะใช้ค่าของตัวเอง)',
    'notify.ruleLabel':'{d} วัน และ {h} ชั่วโมง',
    'notify.setting.hint':'ตอนเปิดแอปจะแจ้งงานที่ถึงกำหนดภายใน {d} วัน · ส่วนงานที่เหลือไม่ถึง {h} ชั่วโมง จะแจ้งเตือนระหว่างใช้งานด้วย',
    'notify.daysTitle':'ล่วงหน้ากี่วัน', 'notify.daysDesc':'แจ้งเตือนตอนเปิดแอปเท่านั้น',
    'notify.hoursTitle':'ล่วงหน้ากี่ชั่วโมง', 'notify.hoursDesc':'แจ้งเตือนทั้งตอนเปิดแอป และระหว่างใช้งานอยู่',
    'notify.unitDays':'วัน', 'notify.unitHours':'ชั่วโมง',
    'toast.overdue':'เลยกำหนดแล้ว ({n} งาน)', 'toast.hour':'ใกล้ถึงกำหนดในไม่กี่ชั่วโมง ({n} งาน)', 'toast.day':'ใกล้ถึงกำหนด ({n} งาน)',
    'undo.btn':'เลิกทำ', 'undo.left':'เลิกทำได้อีก {n} วินาที',
    'undo.room':'ลบห้อง "{name}" แล้ว',
    'undo.import':'นำเข้าแล้ว — สร้าง {c} · แก้ {u} · ลบ {d}',
    'undo.json':'แทนที่ข้อมูลทั้งหมดแล้ว — {r} ห้อง · {c} การ์ด',
    'toast.more':'และอีก {n} งาน', 'toast.close':'ปิด', 'toast.lockedHint':'ปิดได้ในอีก 5 วินาที',
    'notify.nDays':'{n} วัน', 'notify.nHours':'{n} ชม.', 'notify.nMins':'{n} นาที',
    'notify.left':'เหลืออีก {t}', 'notify.late':'เลยกำหนด {t}', 'notify.now':'ถึงกำหนดแล้ว', 'notify.customTag':'ตั้งค่าเอง',
    'setting.notify':'การแจ้งเตือน', 'setting.notify.desc':'ตั้งค่าว่าจะเริ่มแจ้งเตือนล่วงหน้านานแค่ไหนก่อนถึงกำหนด · งานที่เข้าเงื่อนไขจะไปรวมอยู่ในหน้า Notification · แต่ละการ์ดตั้งค่าแยกของตัวเองได้ในฟอร์มการ์ด',
    'setting.tab.notify':'ตั้งค่าการแจ้งเตือน',
    'if.crumb':'นำข้อมูลออกเป็น CSV และนำกลับเข้ามาเพื่ออัปเดตหรือลบ',
    'if.crumbStore':'สำรอง/กู้คืนข้อมูล Simple Store',
    'if.export':'ส่งออก', 'if.export.all':'ทุกห้อง', 'if.export.btn':'ดาวน์โหลด CSV', 'if.export.done':'ดาวน์โหลดแล้ว {n} การ์ด',
    'if.export.desc':'ดาวน์โหลดการ์ดเป็นไฟล์ CSV (เปิดด้วย Excel ได้ ภาษาไทยไม่เพี้ยน) · เลือกได้ว่าทั้งหมดหรือเฉพาะห้องเดียว · ไฟล์นี้พกข้อมูลการ์ดครบทุกช่อง',
    'if.import':'นำเข้า', 'if.import.apply':'ยืนยันนำเข้า', 'if.chooseFile':'เลือกไฟล์', 'if.noFile':'ยังไม่ได้เลือกไฟล์',
    'if.import.desc':'อัปโหลดไฟล์ CSV ที่แก้แล้ว · แถวที่มี card_id จะถูกอัปเดต · แถวที่ card_id ว่างจะถูกสร้างใหม่ · ใส่ delete ในคอลัมน์ action เพื่อลบแถวนั้น',
    'if.columns':'คอลัมน์ที่ต้องมี: {t} · คอลัมน์วันที่คือ due_<ชื่อ Status> และ time_<ชื่อ Status> · ตอนลบ ระบบจะเทียบทุกเซลล์ที่กรอกไว้กับการ์ดจริง เซลล์ที่เว้นว่างจะไม่ถูกนำมาเทียบ',
    'if.chip.create':'สร้างใหม่', 'if.chip.update':'อัปเดต', 'if.chip.delete':'ลบ', 'if.chip.error':'ข้อผิดพลาด',
    'if.report.errors':'ข้อผิดพลาด', 'if.report.warnings':'คำเตือน', 'if.report.row':'แถว', 'if.report.problem':'ปัญหา',
    'if.report.more':'และอีก {n} รายการ', 'if.report.abort':'ไม่มีการเขียนข้อมูลใด ๆ จนกว่าจะไม่เหลือข้อผิดพลาด',
    'if.confirm':'ยืนยันนำเข้า? สร้างใหม่ {c} · อัปเดต {u} · ลบ {d} — การลบย้อนกลับไม่ได้',
    'if.applied':'นำเข้าสำเร็จ — สร้างใหม่ {c} · อัปเดต {u} · ลบ {d}',
    'if.err.fileType':'ไฟล์ "{t}" ไม่ใช่ .csv',
    'if.err.xlsx':'ไฟล์ Excel (.xlsx/.xls) อ่านไม่ได้ กรุณา Save As เป็น CSV UTF-8 ก่อน',
    'if.err.empty':'ไฟล์ว่าง', 'if.err.noRows':'ไฟล์มีแต่หัวตาราง ไม่มีข้อมูล',
    'if.err.quote':'เครื่องหมายคำพูดในไฟล์ไม่สมดุล อ่านไฟล์ไม่ได้',
    'if.err.read':'อ่านไฟล์ไม่สำเร็จ', 'if.err.parse':'แปลงไฟล์ไม่สำเร็จ',
    'if.err.header':'หัวตารางขาดคอลัมน์: {t}',
    'if.err.cols':'จำนวนคอลัมน์ไม่ตรงกับหัวตาราง (มี {n} ควรเป็น {m})',
    'if.err.action':'action "{t}" ไม่ถูกต้อง (ต้องว่าง, update หรือ delete)',
    'if.err.room':'ไม่พบห้อง room_id "{t}"',
    'if.err.cardNotFound':'ไม่พบการ์ด card_id "{t}" ในห้องนี้',
    'if.err.cardOtherRoom':'card_id "{t}" อยู่ในห้อง "{r}" ไม่ใช่ห้องที่ระบุ',
    'if.err.topic':'topic ว่างไม่ได้',
    'if.err.status':'status "{t}" ไม่มีในห้อง "{r}"',
    'if.err.category':'category "{t}" ไม่มีในห้อง "{r}"',
    'if.err.date':'{c} = "{t}" ไม่ใช่วันที่รูปแบบ YYYY-MM-DD ที่มีอยู่จริง',
    'if.err.time':'{c} = "{t}" ไม่ใช่เวลารูปแบบ HH:MM',
    'if.err.timeNoDate':'มีเวลาของ Status "{t}" แต่ไม่มีวันที่',
    'if.err.completeDue':'ต้องมีวันที่ของ Status "{t}" (Status ที่ล็อกไว้)',
    'if.err.noDueCols':'สร้างการ์ดใหม่ไม่ได้ เพราะไฟล์ไม่มีคอลัมน์ due_{t}',
    'if.err.dueForeignStatus':'คอลัมน์ due_{t} ไม่ใช่ Status ของห้อง "{r}"',
    'if.err.colorMode':'color_mode "{t}" ไม่ถูกต้อง (category, status หรือ custom)',
    'if.err.customColor':'custom_color "{t}" ไม่ใช่รหัสสีแบบ #RRGGBB',
    'if.err.notifyMode':'notify_mode "{t}" ไม่ถูกต้อง (default หรือ custom)',
    'if.err.notifyValue':'notify_days/notify_hours "{t}" ต้องเป็น 1, 3 หรือ 5',
    'if.err.delNoMatch':'ต้องการลบ แต่ไม่พบการ์ดที่ข้อมูลตรงกับแถวนี้ ("{t}")',
    'if.err.delFieldMismatch':'ต้องการลบ แต่ข้อมูลในแถวไม่ตรงกับการ์ดที่มีอยู่ — {t}',
    'if.err.dupTarget':'การ์ด "{t}" ถูกอ้างถึงมากกว่าหนึ่งแถว (แถว {a} และ {b})',
    'if.mm.file':'ในไฟล์', 'if.mm.stored':'ในระบบ',
    'if.err.delAmbiguous':'ต้องการลบ แต่ข้อมูลในแถวตรงกัน {n} การ์ด ("{t}") กรุณาระบุ card_id หรือกรอกคอลัมน์ให้ครบขึ้น',
    'if.err.delNeedKey':'ต้องการลบ แต่ไม่มีทั้ง card_id และ topic ให้ค้นหา',
    'if.err.noChanges':'ไม่มีแถวใดที่เปลี่ยนแปลงข้อมูล',
    'if.err.nothingToExport':'ยังไม่มีห้องให้ส่งออก',
    'if.warn.unknownCols':'คอลัมน์ที่ระบบไม่รู้จักและจะถูกข้าม: {t}',
    'if.warn.roomName':'แถว {r}: room_name "{a}" ไม่ตรงกับชื่อห้องปัจจุบัน "{b}" (ใช้ room_id เป็นหลัก)',
    'ink.title':'สีตัวอักษรบนสถานะและหมวดหมู่',
    'ink.desc':'ใช้กับป้ายสถานะและหมวดหมู่ทุกที่ที่ตัวอักษรวางบนสีพื้น',
    'ink.mode.theme':'ตามธีม', 'ink.mode.dark':'เข้ม', 'ink.mode.light':'อ่อน', 'ink.mode.custom':'กำหนดเอง',
    'ink.customHint':'สีนี้จะถูกใช้กับทุกป้ายสถานะและหมวดหมู่ ไม่ว่าพื้นหลังจะเป็นสีอะไร',
    'ink.ok':'ทุกสีอ่านออก (contrast ≥ 4.5:1)',
    'ink.warn':'มี {n} สีที่ตัวอักษรจะอ่านยาก (ต่ำกว่า 4.5:1) — ระบบจะทำตามที่เลือก ไม่แก้ให้อัตโนมัติ',
    'card.textColor':'สีตัวอักษรบนป้ายสถานะและหมวดหมู่',
    'card.textColor.default':'ตามค่าเริ่มต้น', 'card.textColor.custom':'กำหนดเอง',
    'card.textColor.hint':'contrast กับสี Status ปัจจุบัน {r}:1',
    'card.textColor.low':'อ่านยาก',
    'if.export.json':'ดาวน์โหลด JSON (สำรองทั้งหมด)',
    'if.export.jsonDesc':'JSON พกทุกอย่าง — ห้อง, การ์ด, โน้ต, Status/Category และสี · เป็นไฟล์เดียวที่กู้แอปกลับมาได้ทั้งหมด · CSV พกเฉพาะการ์ด',
    'if.export.jsonDone':'ดาวน์โหลดแล้ว {r} ห้อง',
    'if.import.settings':'กู้การตั้งค่าด้วย (ธีม, โหมดสว่าง/มืด, สีตัวอักษร, โลโก้, ภาษา, โซนเวลา)',
    'if.chip.rooms':'ห้อง', 'if.chip.cards':'การ์ด', 'if.chip.notes':'โน้ต',
    'if.json.replace':'ไฟล์ JSON จะ "แทนที่" ข้อมูลทั้งหมด ไม่ใช่รวมเข้าด้วยกัน — ของเดิม {r} ห้อง {c} การ์ด จะหายไป (กด เลิกทำ ได้ทันทีหลังนำเข้า)',
    'if.json.confirm':'แทนที่ข้อมูลทั้งหมด?\n\nของเดิม: {or} ห้อง · {oc} การ์ด\nของใหม่: {nr} ห้อง · {nc} การ์ด\n\nกด เลิกทำ ได้ภายใน 20 วินาทีหลังนำเข้า',
    'if.json.applied':'นำเข้าแล้ว {r} ห้อง · {c} การ์ด',
    'if.err.jsonParse':'ไฟล์นี้ไม่ใช่ JSON ที่อ่านได้',
    'if.err.jsonShape':'JSON ต้องเป็น object ไม่ใช่ array หรือค่าเดี่ยว',
    'if.err.jsonApp':'ไฟล์นี้ไม่ได้มาจากแอปนี้ (app = "{t}")',
    'if.err.jsonSchema':'schema {t} ใหม่กว่าที่แอปนี้รองรับ',
    'if.err.jsonNoRooms':'ไม่มีห้องในไฟล์',
    'if.err.jsonRoom':'{at} ไม่ใช่ object',
    'if.err.jsonField':'{at} ขาดหายหรือผิดชนิด',
    'if.err.jsonDupRoom':'{at} room id "{t}" ซ้ำ',
    'if.err.jsonDup':'{at} ค่า "{t}" ซ้ำ',
    'if.err.jsonColor':'{at} "{t}" ไม่ใช่รหัสสีแบบ #RRGGBB',
    'if.err.jsonNoComplete':'{at} ไม่มี Status ที่ตั้ง isComplete ไว้',
    'if.err.jsonStatus':'{at} Status "{t}" ไม่มีอยู่ในห้องนี้',
    'if.err.jsonCategory':'{at} Category "{t}" ไม่มีอยู่ในห้องนี้',
    'if.err.jsonEnum':'{at} ค่า "{t}" ไม่ถูกต้อง',
    'if.err.jsonDate':'{at} "{t}" ไม่ใช่วันที่แบบ YYYY-MM-DD',
    'if.err.jsonTime':'{at} "{t}" ไม่ใช่เวลาแบบ HH:MM',
    'if.warn.jsonOldSchema':'ไฟล์เป็น schema {t} ซึ่งเก่ากว่าปัจจุบัน แต่ยังอ่านได้',
    'if.warn.jsonNoSettings':'ไฟล์นี้ไม่มีการตั้งค่า จะกู้เฉพาะข้อมูล',
    'if.err.textMode':'text_mode "{t}" ไม่ถูกต้อง (default หรือ custom)',
    'if.err.textColor':'text_color "{t}" ไม่ใช่รหัสสีแบบ #RRGGBB',
    'setting.tab.theme':'ตั้งค่าธีม', 'setting.theme':'ธีมสี',
    'theme.mode':'โหมดสว่าง / โหมดมืด', 'theme.mode.light':'สว่าง', 'theme.mode.dark':'มืด',
    'theme.mode.desc':'สลับได้ทุกชุดสี · สีของสถานะและหมวดหมู่ที่ตั้งไว้จะไม่เปลี่ยน แต่ตัวอักษรบนนั้นจะปรับให้อ่านออกเสมอ', 'theme.custom':'กำหนดเอง',
    'theme.custom.section':'ปรับแต่งเอง (Custom)', 'theme.custom.sectionDesc':'สร้าง palette ของคุณเอง — เลือกสี 4 ตัว ที่เหลือคำนวณให้อัตโนมัติ',
    'theme.presets':'ธีมสำเร็จรูป', 'theme.presets.desc':'ชุดสีที่จัดไว้ให้เลือกใช้',
    'theme.custom.title':'ปรับสีเอง', 'theme.custom.reset':'คืนค่าเริ่มต้น',
    'theme.custom.desc':'เลือกสี 4 ตัว ที่เหลืออีก 11 token คำนวณให้อัตโนมัติ และจะบังคับให้ตัวอักษรอ่านออกเสมอ',
    'theme.custom.adjusted':'ปรับให้เข้มขึ้นอัตโนมัติเพื่อให้ตัวอักษรขาวยังอ่านออก — {t}',
    'theme.custom.darktext':'สีปุ่มอ่อนเกินกว่าจะใช้ตัวอักษรขาว จึงเปลี่ยนเป็นตัวอักษรสีเข้มบนปุ่มแทน',
    'theme.seed.deep':'แถบข้าง', 'theme.seed.accent':'ปุ่มและ accent', 'theme.seed.pop':'ไฮไลต์', 'theme.seed.pale':'สีอ่อน', 'setting.theme.desc':'เลือกชุดสีของแอป · มีผลกับแถบข้าง พื้นหลัง ปุ่ม และเส้นขอบ · สีของสถานะและหมวดหมู่ตั้งแยกในหน้าตั้งค่า', 'theme.active':'ใช้อยู่',
    'card.notify':'การแจ้งเตือน', 'card.notify.default':'ตามค่าเริ่มต้น', 'card.notify.custom':'กำหนดเอง',
    'card.notify.hint':'แจ้งเตือนล่วงหน้า {d} วัน และ {h} ชั่วโมง ก่อนถึงกำหนด',
    'setting.rooms':'ห้อง', 'setting.rooms.desc':'เพิ่ม ลบ เปลี่ยนชื่อ และจัดลำดับห้องได้สูงสุด {n} ห้อง · ลากไอคอน ⠿ เพื่อจัดลำดับ · แต่ละห้องมี Task, Calendar และ Note แยกกัน · ห้องที่มี 🔒 คือห้องสุดท้าย ลบไม่ได้ · การลบห้องจะลบข้อมูลในห้องทั้งหมด', 'setting.rooms.add':'+ เพิ่มห้อง', 'setting.rooms.full':'ครบ {n} ห้องแล้ว', 'setting.tab.app':'ตั้งค่าแอป', 'setting.tab.rooms':'จัดการห้อง', 'setting.statuscat':'สถานะและหมวดหมู่', 'setting.statuscat.desc':'แต่ละห้องมี Status และ Category ของตัวเอง เลือกห้องที่ต้องการแก้ไขก่อน · ลากไอคอน ⠿ เพื่อจัดลำดับ · Status ที่มี 🔒 คือ "เสร็จสมบูรณ์" ซึ่งซิงค์กับหน้า Completed — แก้ชื่อและสีได้ แต่ลบไม่ได้', 'setting.editRoom':'แก้ไขห้อง', 'setting.category':'หมวดหมู่', 'setting.category.desc':'สีของ Category จะแสดงบนการ์ดและบนปฏิทิน · ต้องเหลืออย่างน้อย 1 Category เพราะทุกการ์ดต้องมีหมวดหมู่', 'setting.category.add':'+ เพิ่ม Category',
    'category.newName':'หมวดหมู่ใหม่', 'category.delete':'ลบ Category', 'alert.dupCategory':'มี Category ชื่อนี้อยู่แล้ว', 'alert.cantDeleteLastCategory':'ต้องเหลืออย่างน้อย 1 Category ลบอันสุดท้ายไม่ได้', 'confirm.deleteCategory':'ลบ Category "{s}" ใช่ไหม?', 'confirm.deleteCategoryUsed':'มีการ์ด {n} ใบใช้ Category "{s}" อยู่\n\nถ้าลบ การ์ดเหล่านั้นจะถูกย้ายไป Category แรกที่เหลือ ยืนยันไหม?',
    'room.newName':'ห้องใหม่', 'room.nameEn':'ชื่อห้อง (อังกฤษ)', 'room.nameTh':'ชื่อห้อง (ไทย)', 'alert.roomNameEnRequired':'ต้องมีชื่อห้องภาษาอังกฤษ', 'room.delete':'ลบห้อง', 'room.count':'{c} งาน · {n} โน้ต', 'alert.maxRooms':'เพิ่มได้สูงสุด {n} ห้อง', 'alert.dupRoom':'มีห้องชื่อนี้อยู่แล้ว', 'alert.cantDeleteLastRoom':'ต้องเหลืออย่างน้อย 1 ห้อง ลบห้องสุดท้ายไม่ได้', 'confirm.deleteRoom':'ลบห้อง "{name}" ใช่ไหม?\n\nข้อมูลในห้องจะหายทั้งหมด ({cards} Task, {notes} Note) และกู้คืนไม่ได้',
    'common.addCard':'+ เพิ่มการ์ด', 'common.addNote':'+ เพิ่มโน้ต',
    'common.clearFilter':'ล้างตัวกรอง', 'common.today':'วันนี้', 'common.cancel':'ยกเลิก', 'common.save':'บันทึก',
    'filter.all':'ทั้งหมด', 'filter.status':'สถานะ', 'filter.category':'หมวดหมู่', 'filter.from':'จากวันที่', 'filter.to':'ถึงวันที่',
    'sort.by':'เรียงตาม', 'sort.due':'Due Date (ตาม Status ปัจจุบัน)', 'sort.status':'สถานะ', 'sort.category':'หมวดหมู่', 'sort.dueOf':'วันที่ {s}',
    'filter.searchTopic':'ค้นหา Topic',
    'list.empty':'ไม่มีรายการที่ตรงกับตัวกรอง', 'completed.empty':'ยังไม่มีงานที่เสร็จสมบูรณ์',
    'notes.empty':'ยังไม่มีโน้ต เริ่มจดอันแรกได้เลย',
    'wd.mon':'จ','wd.tue':'อ','wd.wed':'พ','wd.thu':'พฤ','wd.fri':'ศ','wd.sat':'ส','wd.sun':'อา',
    'th.topic':'หัวข้อ', 'th.currentStatus':'สถานะปัจจุบัน', 'th.category':'หมวดหมู่', 'th.completedDate':'วันที่เสร็จ',
    'setting.language':'ภาษา', 'setting.language.desc':'เลือกภาษาที่ใช้แสดงผลทั้งแอป',
    'setting.timezone':'โซนเวลา',
'setting.timezone.desc':'ใช้ตัดสินว่า "วันนี้" คือวันไหน และเวลาครบกำหนดของแต่ละงานตรงกับเวลาจริงเมื่อไหร่ · ค่าเริ่มต้นคือ Asia/Bangkok', 'setting.timezone.now':'ตอนนี้ในโซนนี้: {t}',
    'setting.logo':'โลโก้', 'setting.logo.desc':'อัปโหลดรูปเพื่อใช้เป็นโลโก้ที่มุมซ้ายบน · SVG ดีที่สุด (เล็กและคมทุกความละเอียด) หรือ PNG พื้นหลังโปร่งใส · ไฟล์ไม่เกิน 256 KB',
    'setting.logo.choose':'เลือกรูป…', 'setting.logo.remove':'ลบโลโก้', 'setting.logo.style.desc':'การแสดงผลโลโก้บนแถบด้านซ้าย (พื้นสีเข้ม) — “ถมขาว” จะเปลี่ยนโลโก้เป็นเงาสีขาวเพื่อให้เห็นชัดเสมอ ส่วน “สีต้นฉบับ” จะคงสีเดิมของรูปไว้', 'setting.logo.style.white':'ถมขาว', 'setting.logo.style.original':'สีต้นฉบับ',
    'setting.logo.empty':'ยังไม่มีโลโก้',
    'setting.status':'สถานะ',
    'setting.status.desc':'เพิ่ม ลบ แก้ไขชื่อ และเลือกสีของสถานะได้ตามต้องการ · ลากไอคอน ⠿ เพื่อจัดลำดับ · สถานะที่มี 🔒 คือ "เสร็จสมบูรณ์" ซึ่งซิงค์กับหน้า Completed — แก้ชื่อและสีได้ แต่ลบไม่ได้',
    'setting.status.add':'+ เพิ่ม Status',
    'card.add':'เพิ่มการ์ด', 'card.edit':'แก้ไขการ์ด',
    'card.topic':'หัวข้อ (Topic) *', 'card.details':'รายละเอียด (Details)',
    'card.room':'ห้อง (Room)', 'card.color':'สีบนปฏิทิน', 'card.color.category':'ตาม Category', 'card.color.status':'ตาม Status', 'card.color.custom':'กำหนดเอง', 'card.color.customHint':'เลือกสีที่จะใช้กับ chip ของการ์ดนี้บนปฏิทิน', 'card.category':'หมวดหมู่', 'card.status':'สถานะ', 'card.dueDates':'Due Date และเวลา ของแต่ละ Status', 'card.timeTitle':'เวลา (ไม่บังคับ)',
    'card.topicPh':'เช่น นัดเจอเพื่อน, ไปเที่ยว, งานสำคัญ',
    'card.detailsPh':'รายละเอียดเพิ่มเติม...',
    'note.add':'เพิ่มโน้ต', 'note.edit':'แก้ไขโน้ต', 'note.topic':'หัวข้อ *', 'note.content':'เนื้อหา',
    'note.delete':'ลบโน้ตนี้', 'note.topicPh':'เช่น ไอเดียเรื่อง...', 'note.contentPh':'เขียนอะไรก็ได้ตรงนี้...',
    'error.recent':'ข้อผิดพลาดล่าสุด', 'error.clearAll':'ล้างทั้งหมด',
    // dynamic
    'kanban.empty':'ไม่มีการ์ด', 'kanban.completeHint':'ลากการ์ดมาวางที่นี่ → ย้ายไปหน้า Completed อัตโนมัติ',
    'kanban.addInStatus':'เพิ่มการ์ดในสถานะนี้', 'action.edit':'แก้ไข', 'action.delete':'ลบ',
    'badge.overdue':'⚠️ เลยกำหนด', 'chip.overdue':'เลยกำหนด',
    'chip.task':'งาน:', 'chip.current':'ปัจจุบัน:',
    'page.prev':'← ก่อนหน้า', 'page.next':'ถัดไป →', 'page.info':'หน้า {p} / {t}',
    'card.required':'* บังคับกรอก', 'btn.saving':'กำลังบันทึก...',
    'status.locked.title':'สถานะ "เสร็จสมบูรณ์" ซิงค์กับหน้า Completed — แก้ชื่อ/สีได้ แต่ลบไม่ได้',
    'status.dragHandle':'ลากเพื่อจัดลำดับ', 'status.color':'เลือกสี', 'status.delete':'ลบสถานะ',
    'status.newName':'สถานะใหม่',
    // alerts / confirms
    'alert.needTopic':'กรุณากรอกหัวข้อ (Topic)',
    'alert.needCompleteDue':'กรุณากรอก Due Date ของสถานะ "{s}" ด้วยค่ะ (บังคับกรอก)',
    'confirm.deleteCard':'ลบการ์ดนี้ใช่ไหมคะ?',
    'alert.needNoteTopic':'กรุณากรอก Topic ก่อนนะคะ', 'confirm.deleteNote':'ลบโน้ตนี้ใช่ไหมคะ?',
    'alert.dupStatus':'มีชื่อ Status นี้อยู่แล้ว ใช้ชื่อซ้ำไม่ได้ค่ะ',
    'alert.cantDeleteComplete':'สถานะ "เสร็จสมบูรณ์" ลบไม่ได้ค่ะ',
    'confirm.deleteStatusUsed':'มีการ์ด {n} ใบใช้สถานะ "{s}" อยู่ ถ้าลบ การ์ดเหล่านั้นจะถูกย้ายไปสถานะแรกสุด ยืนยันลบไหมคะ?',
    'confirm.deleteStatus':'ลบสถานะ "{s}" ใช่ไหมคะ?',
    'confirm.removeLogo':'ลบโลโก้ที่อัปโหลดไว้ใช่ไหมคะ?',
    'alert.logoTooBig':'ไฟล์โลโก้ {a} ใหญ่เกินเพดาน {b} — โลโก้แสดงกว้างสุดแค่ 250px ใช้ SVG หรือ PNG ขนาดเล็กก็คมแล้วค่ะ',
    'alert.logoNotImage':'ไฟล์นี้ไม่ใช่รูปภาพ',
    'alert.logoRead':'อ่านไฟล์โลโก้ไม่สำเร็จ',
    'alert.logoFull':'พื้นที่เก็บข้อมูลของเบราว์เซอร์เต็ม บันทึกโลโก้ไม่ได้ (ข้อมูลงานไม่ได้รับผลกระทบ) ต้องลดข้อมูลลงก่อน',
    'alert.saveFail':'บันทึกข้อมูลไม่สำเร็จ ลองใหม่อีกครั้งนะคะ',
    'alert.saveFull':'พื้นที่เก็บข้อมูลของเบราว์เซอร์เต็ม บันทึกไม่ได้ — การลองใหม่ไม่ช่วย ต้องลดข้อมูลลงก่อน ระหว่างนี้ทุกอย่างที่แก้จะหายเมื่อปิดแท็บ'

  },
  en: {
    'login.title':'Sign in', 'login.submit':'Sign in',
    'login.hint':'Sign in with the owner account',
    'sidebar.logout':'Logout',
    'task.crumb':'Task Board', 'calendar.crumb':'All deadlines in one calendar',
    'note.crumb':'Free notes — jot down anything', 'setting.crumb':'App settings',
    'maincal.crumb':'All deadlines from every room', 'globalnote.crumb':'General notes, not tied to any room',
    'nav.home':'Home', 'nav.maincal':'Main Calendar', 'nav.globalnote':'Note', 'nav.notify':'Notification',
    'nav.interface':'Import / Export', 'nav.setting':'Admin App Setting', 'nav.usersetting':'Theme & Language', 'nav.cat.inventory':'Inventory & Sales', 'nav.cat.org':'Organization', 'nav.cat.accounting':'Accounting', 'nav.cat.hr':'Employee Management', 'nav.cat.setting':'Setting', 'nav.task':'Task', 'nav.calendar':'Calendar', 'nav.note':'Note',
    'ui.category':'Category', 'ui.status':'Status', 'ui.board':'Board', 'ui.list':'List', 'ui.completed':'Completed', 'ui.email':'Email', 'ui.password':'Password',
    'home.crumb':'An overview of everything', 'home.cards':'cards', 'home.noRoom':'No room created yet', 'home.noCards':'No cards in this room yet',
    'home.showRoom':'Show room', 'home.byStatus':'Status', 'home.byCategory':'Category',
    'home.today':'Due today', 'home.today.desc':'Unfinished tasks from every room that are due today', 'home.today.empty':'Nothing is due today',
    'home.progress':'Progress', 'home.progress.desc':'How much is complete versus still in progress',
    'home.allRooms':'All rooms', 'home.complete':'Complete', 'home.inProgress':'In Progress', 'home.total':'Total',
    'notify.crumb':'Deadlines coming up across every room', 'notify.empty':'Nothing is due soon',
    'notify.page.hint':'Unfinished tasks due within {t} (cards with their own rule use that instead)',
    'notify.ruleLabel':'{d} days and {h} hours',
    'notify.setting.hint':'On launch you are told about anything due within {d} days · anything under {h} hours away also warns you while you work',
    'notify.daysTitle':'How many days ahead', 'notify.daysDesc':'Announced when the app opens',
    'notify.hoursTitle':'How many hours ahead', 'notify.hoursDesc':'Announced on open and while you are working',
    'notify.unitDays':'Days', 'notify.unitHours':'Hours',
    'toast.overdue':'Overdue ({n})', 'toast.hour':'Due within hours ({n})', 'toast.day':'Coming up ({n})',
    'undo.btn':'Undo', 'undo.left':'{n}s left to undo',
    'undo.room':'Deleted room "{name}"',
    'undo.import':'Imported — {c} created · {u} updated · {d} deleted',
    'undo.json':'Replaced everything — {r} rooms · {c} cards',
    'toast.more':'and {n} more', 'toast.close':'Close', 'toast.lockedHint':'Can be closed in 5 seconds',
    'notify.nDays':'{n}d', 'notify.nHours':'{n}h', 'notify.nMins':'{n}m',
    'notify.left':'{t} left', 'notify.late':'{t} overdue', 'notify.now':'Due now', 'notify.customTag':'Custom',
    'setting.notify':'Notification', 'setting.notify.desc':'Choose how far ahead a deadline starts warning you · matching tasks are gathered on the Notification page · any card can override this in its own form',
    'setting.tab.notify':'Notification Setting',
    'if.crumb':'Export your data to CSV and bring it back to update or delete',
    'if.crumbStore':'Back up / restore your Simple Store data',
    'if.export':'Export', 'if.export.all':'All rooms', 'if.export.btn':'Download CSV', 'if.export.done':'Downloaded {n} cards',
    'if.export.desc':'Download cards as CSV (opens in Excel, Thai text intact) · all rooms or just one · the file carries every field a card has',
    'if.import':'Import', 'if.import.apply':'Apply import', 'if.chooseFile':'Choose file', 'if.noFile':'No file chosen',
    'if.import.desc':'Upload the edited CSV · rows with a card_id are updated · rows with an empty card_id are created · put delete in the action column to remove that row',
    'if.columns':'Required columns: {t} · date columns are due_<Status name> and time_<Status name> · on delete every filled cell must match the stored card; blank cells are not compared',
    'if.chip.create':'Create', 'if.chip.update':'Update', 'if.chip.delete':'Delete', 'if.chip.error':'Errors',
    'if.report.errors':'Errors', 'if.report.warnings':'Warnings', 'if.report.row':'Row', 'if.report.problem':'Problem',
    'if.report.more':'and {n} more', 'if.report.abort':'Nothing is written until every error is gone',
    'if.confirm':'Apply this import? Create {c} · update {u} · delete {d} — deletions cannot be undone',
    'if.applied':'Import applied — created {c} · updated {u} · deleted {d}',
    'if.err.fileType':'"{t}" is not a .csv file',
    'if.err.xlsx':'Excel files (.xlsx/.xls) cannot be read — save as CSV UTF-8 first',
    'if.err.empty':'The file is empty', 'if.err.noRows':'The file has a header but no rows',
    'if.err.quote':'Unbalanced quotes in the file — it cannot be parsed',
    'if.err.read':'Could not read the file', 'if.err.parse':'Could not parse the file',
    'if.err.header':'Header is missing columns: {t}',
    'if.err.cols':'Column count does not match the header ({n} found, {m} expected)',
    'if.err.action':'action "{t}" is invalid (leave blank, or use update / delete)',
    'if.err.room':'No room with room_id "{t}"',
    'if.err.cardNotFound':'No card with card_id "{t}" in this room',
    'if.err.cardOtherRoom':'card_id "{t}" belongs to room "{r}", not the one given',
    'if.err.topic':'topic cannot be empty',
    'if.err.status':'status "{t}" does not exist in room "{r}"',
    'if.err.category':'category "{t}" does not exist in room "{r}"',
    'if.err.date':'{c} = "{t}" is not a real date in YYYY-MM-DD form',
    'if.err.time':'{c} = "{t}" is not a time in HH:MM form',
    'if.err.timeNoDate':'a time is set for status "{t}" but no date',
    'if.err.completeDue':'a date for status "{t}" (the locked status) is required',
    'if.err.noDueCols':'cannot create a card: the file has no due_{t} column',
    'if.err.dueForeignStatus':'column due_{t} is not a status of room "{r}"',
    'if.err.colorMode':'color_mode "{t}" is invalid (category, status or custom)',
    'if.err.customColor':'custom_color "{t}" is not a #RRGGBB colour',
    'if.err.notifyMode':'notify_mode "{t}" is invalid (default or custom)',
    'if.err.notifyValue':'notify_days/notify_hours "{t}" must be 1, 3 or 5',
    'if.err.delNoMatch':'delete requested but no card matches this row ("{t}")',
    'if.err.delFieldMismatch':'delete requested but the row does not match the stored card — {t}',
    'if.err.dupTarget':'card "{t}" is claimed by more than one row (rows {a} and {b})',
    'if.mm.file':'file', 'if.mm.stored':'stored',
    'if.err.delAmbiguous':'delete requested but the row matches {n} cards ("{t}") — give a card_id or fill in more columns',
    'if.err.delNeedKey':'delete requested but neither card_id nor topic was given',
    'if.err.noChanges':'No row changes anything',
    'if.err.nothingToExport':'There are no rooms to export',
    'if.warn.unknownCols':'Unknown columns will be ignored: {t}',
    'if.warn.roomName':'Row {r}: room_name "{a}" does not match the current room name "{b}" (room_id wins)',
    'ink.title':'Text colour on Status and Category',
    'ink.desc':'Applies to every pill and chip whose background is a Status or Category colour · any card can override it',
    'ink.mode.theme':'Follow theme', 'ink.mode.dark':'Dark', 'ink.mode.light':'Light', 'ink.mode.custom':'Custom',
    'ink.customHint':'This colour is used on every pill and chip, whatever the background',
    'ink.ok':'Every colour is legible (contrast ≥ 4.5:1)',
    'ink.warn':'{n} colours will be hard to read (under 4.5:1) — your choice is applied as-is, nothing is corrected',
    'card.textColor':'Text colour on chips and pills',
    'card.textColor.default':'Use default', 'card.textColor.custom':'Custom',
    'card.textColor.hint':'contrast against the current Status colour {r}:1',
    'card.textColor.low':'hard to read',
    'if.export.json':'Download JSON (full backup)',
    'if.export.jsonDesc':'JSON carries everything — rooms, cards, notes, Status/Category and colours · the only file that can restore this app · CSV carries cards only',
    'if.export.jsonDone':'Downloaded {r} rooms',
    'if.import.settings':'Restore settings too (theme, light/dark, text colour, logo, language, timezone)',
    'if.chip.rooms':'rooms', 'if.chip.cards':'cards', 'if.chip.notes':'notes',
    'if.json.replace':'A JSON import REPLACES everything, it does not merge — your current {r} rooms and {c} cards will be gone (Undo is offered right after)',
    'if.json.confirm':'Replace everything?\n\nCurrent: {or} rooms · {oc} cards\nIncoming: {nr} rooms · {nc} cards\n\nUndo is available for 20 seconds afterwards',
    'if.json.applied':'Imported {r} rooms · {c} cards',
    'if.err.jsonParse':'This file is not readable JSON',
    'if.err.jsonShape':'JSON must be an object, not an array or a bare value',
    'if.err.jsonApp':'This file did not come from this app (app = "{t}")',
    'if.err.jsonSchema':'schema {t} is newer than this app supports',
    'if.err.jsonNoRooms':'The file contains no rooms',
    'if.err.jsonRoom':'{at} is not an object',
    'if.err.jsonField':'{at} is missing or the wrong type',
    'if.err.jsonDupRoom':'{at} room id "{t}" is duplicated',
    'if.err.jsonDup':'{at} value "{t}" is duplicated',
    'if.err.jsonColor':'{at} "{t}" is not a #RRGGBB colour',
    'if.err.jsonNoComplete':'{at} has no Status marked isComplete',
    'if.err.jsonStatus':'{at} Status "{t}" does not exist in this room',
    'if.err.jsonCategory':'{at} Category "{t}" does not exist in this room',
    'if.err.jsonEnum':'{at} value "{t}" is invalid',
    'if.err.jsonDate':'{at} "{t}" is not a YYYY-MM-DD date',
    'if.err.jsonTime':'{at} "{t}" is not an HH:MM time',
    'if.warn.jsonOldSchema':'The file uses schema {t}, older than the current one, but it can still be read',
    'if.warn.jsonNoSettings':'This file has no settings; only data will be restored',
    'if.err.textMode':'text_mode "{t}" is invalid (default or custom)',
    'if.err.textColor':'text_color "{t}" is not a #RRGGBB colour',
    'setting.tab.theme':'Theme Setting', 'setting.theme':'Theme',
    'theme.mode':'Light / Dark', 'theme.mode.light':'Light', 'theme.mode.dark':'Dark',
    'theme.mode.desc':'Works with every palette · your Status and Category colours stay exactly as set, only the ink on them adapts', 'theme.custom':'Custom',
    'theme.custom.section':'Custom', 'theme.custom.sectionDesc':'Build your own palette — pick four colours and the rest is derived',
    'theme.presets':'Palettes', 'theme.presets.desc':'Ready-made colour schemes',
    'theme.custom.title':'Your palette', 'theme.custom.reset':'Reset',
    'theme.custom.desc':'Pick four colours · the other eleven tokens are derived, and legibility is enforced',
    'theme.custom.adjusted':'Darkened automatically so white text stays readable — {t}',
    'theme.custom.darktext':'That fill is too pale for white text, so buttons print dark text instead',
    'theme.seed.deep':'Sidebar', 'theme.seed.accent':'Buttons & accents', 'theme.seed.pop':'Highlight', 'theme.seed.pale':'Light tone', 'setting.theme.desc':'Pick the app palette · it drives the sidebar, backgrounds, buttons and borders · Status and Category colours are set per room under Room Management', 'theme.active':'In use',
    'card.notify':'Notification', 'card.notify.default':'App default', 'card.notify.custom':'Custom',
    'card.notify.hint':'Warns {d} days and {h} hours before the deadline',
    'setting.rooms':'Rooms', 'setting.rooms.desc':'Add, remove, rename and reorder up to {n} rooms · drag the ⠿ handle to reorder · each room has its own Task, Calendar and Note · the room marked 🔒 is the last one and cannot be deleted · deleting a room destroys all of its data', 'setting.rooms.add':'+ Add Room', 'setting.rooms.full':'Maximum {n} rooms', 'setting.tab.app':'App Setting', 'setting.tab.rooms':'Room Management', 'setting.statuscat':'Status & Category', 'setting.statuscat.desc':'Each room has its own Status and Category — pick the room you want to edit first · drag the ⠿ handle to reorder · the Status marked 🔒 is the completed one that syncs with the Completed view: it can be renamed and recoloured but not deleted', 'setting.editRoom':'Editing room', 'setting.category':'Category', 'setting.category.desc':'Category colours show up on cards and in the calendar · at least one Category must remain, because every card carries one', 'setting.category.add':'+ Add Category',
    'category.newName':'New Category', 'category.delete':'Delete category', 'alert.dupCategory':'A category with this name already exists', 'alert.cantDeleteLastCategory':'At least one Category must remain — the last one cannot be deleted', 'confirm.deleteCategory':'Delete category "{s}"?', 'confirm.deleteCategoryUsed':'{n} card(s) currently use category "{s}".\n\nDeleting it will move them to the first remaining category. Continue?',
    'room.newName':'New Room', 'room.nameEn':'Room name (English)', 'room.nameTh':'Room name (Thai)', 'alert.roomNameEnRequired':'English room name is required', 'room.delete':'Delete room', 'room.count':'{c} Task · {n} Note', 'alert.maxRooms':'You can have at most {n} rooms', 'alert.dupRoom':'A room with this name already exists', 'alert.cantDeleteLastRoom':'At least one room must remain — the last room cannot be deleted', 'confirm.deleteRoom':'Delete room "{name}"?\n\nAll of its data will be lost ({cards} Task, {notes} Note) and cannot be recovered',
    'common.addCard':'+ Add Card', 'common.addNote':'+ Add Note',
    'common.clearFilter':'Clear filters', 'common.today':'Today', 'common.cancel':'Cancel', 'common.save':'Save',
    'filter.all':'All', 'filter.status':'Status', 'filter.category':'Category', 'filter.from':'From date', 'filter.to':'To date',
    'sort.by':'Sort by', 'sort.due':'Due Date (current status)', 'sort.status':'Status', 'sort.category':'Category', 'sort.dueOf':'{s} Date',
    'filter.searchTopic':'Search Topic',
    'list.empty':'No items match the filters', 'completed.empty':'No completed tasks yet',
    'notes.empty':'No notes yet — start your first one',
    'wd.mon':'Mon','wd.tue':'Tue','wd.wed':'Wed','wd.thu':'Thu','wd.fri':'Fri','wd.sat':'Sat','wd.sun':'Sun',
    'th.topic':'Topic', 'th.currentStatus':'Current Status', 'th.category':'Category', 'th.completedDate':'Completed date',
    'setting.language':'Language', 'setting.language.desc':'Choose the display language for the whole app',
    'setting.timezone':'Time zone',
    'setting.timezone.desc':'Decides which day counts as "today" and what real moment each deadline points at · defaults to Asia/Bangkok', 'setting.timezone.now':'Now in this zone: {t}',
    'setting.logo':'Logo', 'setting.logo.desc':'Upload an image for the top-left logo · SVG is best (tiny and sharp at any size), or a transparent PNG · files up to 256 KB',
    'setting.logo.choose':'Choose image…', 'setting.logo.remove':'Remove logo', 'setting.logo.style.desc':'How the logo renders in the dark sidebar — “White” turns it into a white silhouette so it is always legible; “Original” keeps the image colours.', 'setting.logo.style.white':'White', 'setting.logo.style.original':'Original',
    'setting.logo.empty':'No logo yet',
    'setting.status':'Status',
    'setting.status.desc':'Add, remove, rename and pick colors for statuses · drag the ⠿ icon to reorder · the 🔒 status is "Completed" (syncs with the Completed page) — you can rename/recolor it but not delete it',
    'setting.status.add':'+ Add Status',
    'card.add':'Add Card', 'card.edit':'Edit Card',
    'card.topic':'Topic *', 'card.details':'Details',
    'card.room':'Room', 'card.color':'Calendar colour', 'card.color.category':'By Category', 'card.color.status':'By Status', 'card.color.custom':'Custom', 'card.color.customHint':'Pick the colour this card uses on the calendar', 'card.category':'Category', 'card.status':'Status', 'card.dueDates':'Due Date & time per Status', 'card.timeTitle':'Time (optional)',
    'card.topicPh':'e.g. meet a friend, trip, important task',
    'card.detailsPh':'More details...',
    'note.add':'Add Note', 'note.edit':'Edit Note', 'note.topic':'Topic *', 'note.content':'Content',
    'note.delete':'Delete this note', 'note.topicPh':'e.g. idea about...', 'note.contentPh':'Write anything here...',
    'error.recent':'Recent errors', 'error.clearAll':'Clear all',
    'kanban.empty':'No cards', 'kanban.completeHint':'Drop a card here → moves to the Completed page automatically',
    'kanban.addInStatus':'Add a card in this status', 'action.edit':'Edit', 'action.delete':'Delete',
    'badge.overdue':'⚠️ Overdue', 'chip.overdue':'Overdue',
    'chip.task':'Task:', 'chip.current':'Current:',
    'page.prev':'← Prev', 'page.next':'Next →', 'page.info':'Page {p} / {t}',
    'card.required':'* required', 'btn.saving':'Saving...',
    'status.locked.title':'The "Completed" status syncs with the Completed page — rename/recolor allowed, delete not allowed',
    'status.dragHandle':'Drag to reorder', 'status.color':'Pick color', 'status.delete':'Delete status',
    'status.newName':'New Status',
    'alert.needTopic':'Please enter a Topic',
    'alert.needCompleteDue':'Please also set the Due Date for status "{s}" (required)',
    'confirm.deleteCard':'Delete this card?',
    'alert.needNoteTopic':'Please enter a Topic first', 'confirm.deleteNote':'Delete this note?',
    'alert.dupStatus':'That status name already exists — duplicates are not allowed',
    'alert.cantDeleteComplete':'The "Completed" status cannot be deleted',
    'confirm.deleteStatusUsed':'{n} card(s) use status "{s}". Deleting it will move them to the first status. Confirm delete?',
    'confirm.deleteStatus':'Delete status "{s}"?',
    'confirm.removeLogo':'Remove the uploaded logo?',
    'alert.logoTooBig':'The logo file is {a}, over the {b} limit — it renders at most 250px wide, so an SVG or a small PNG is already sharp',
    'alert.logoNotImage':'That file is not an image',
    'alert.logoRead':'Could not read the logo file',
    'alert.logoFull':'Browser storage is full, so the logo could not be saved (your task data is untouched). Some data must be removed first.',
    'alert.saveFail':'Could not save. Please try again.',
    'alert.saveFull':'Browser storage is full, so nothing can be saved — retrying will not help. Some data must be removed first. Until then, everything you change is lost when the tab closes.'

  }
};

function t(key, vars){
  const dict = I18N[currentLang] || I18N.th;
  let s = (key in dict) ? dict[key] : (I18N.th[key] !== undefined ? I18N.th[key] : key);
  if(vars){ Object.keys(vars).forEach(k=>{ s = s.replace(new RegExp('\\{'+k+'\\}','g'), vars[k]); }); }
  return s;
}

function loadLang(){
  try{
    const l = Store.getRaw(LANG_STORAGE_KEY);
    return (l === 'en' || l === 'th') ? l : 'th';
  }catch(e){ return 'th'; }
}
function saveLang(lang){
  try{ Store.setRaw(LANG_STORAGE_KEY, lang); }catch(e){ /* ignore */ }
}
function applyStaticI18n(){
  document.querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el=>{ el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-title]').forEach(el=>{ el.title = t(el.dataset.i18nTitle); });
  document.documentElement.lang = currentLang;
}
function updateLangToggleUI(){
  document.querySelectorAll('.lang-btn').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.lang === currentLang);
  });
}
function applyLanguage(lang){
  currentLang = (lang === 'en') ? 'en' : 'th';
  saveLang(currentLang);
  applyStaticI18n();
  updateLangToggleUI();
  // Re-render everything that builds text in JS.
  const board = getCurrentRoom();
  if(board && board.cards){ refreshBoard(board); }
  if(currentView && currentView.type === 'home') renderHomePage();
  if(document.getElementById('maincal-calendar')) renderMainCalendar();
  if(document.getElementById('notesListWrap')) renderNotesList('room');
  if(document.getElementById('globalNotesListWrap')) renderNotesList('global');
  if(typeof renderSidebar === 'function') renderSidebar();
  updateLogoStyleToggleUI();
  if(document.getElementById('exportRoom')) renderInterfacePage();
  renderSettingLogoPreview();
  if(document.getElementById('inkModeToggle')) renderInkSetting();
  renderActiveModuleOnLangChange();
  renderThemeSetting();
  renderThemeCustomEditor();
  renderTimezoneSetting();
  renderRoomsEditor();
  refreshSettingEditors();
  renderNotifySetting();
  if(document.getElementById('notifyListWrap')) renderNotificationPage();
  showSettingTab(settingTab);
}


/* ============================================================================
 * Months, in one place.
 *
 * Month names used to be copy-pasted into three modules, and pickers were built
 * from hard-coded rolling windows ("last 12 months"), which broke as soon as you
 * needed a future month or a different year. These helpers are year-agnostic:
 * they take/return a plain 'YYYY-MM' key and format it in the current language.
 * ==========================================================================*/
(function(){
  // FULL month names (the short "ม.ค. / Jan" table above is a different thing,
  // used for compact dates — don't merge them).
  const MONTHS_FULL = {
    th: ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'],
    en: ['January','February','March','April','May','June','July','August','September','October','November','December']
  };
  const lang = ()=> ((window.appLang && window.appLang()) === 'en') ? 'en' : 'th';

  window.monthNames = ()=> MONTHS_FULL[lang()].slice();
  window.monthKeyOf = (d)=> `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  window.thisMonthKey = ()=> window.monthKeyOf(new Date());
  // 'YYYY-MM' -> 'กรกฎาคม 2026' / 'July 2026'. Any year, past or future.
  window.monthLabel = (key)=>{
    if(!key || key.length < 7) return '';
    const m = Number(key.slice(5,7)) - 1;
    if(m < 0 || m > 11) return key;
    return MONTHS_FULL[lang()][m] + ' ' + key.slice(0,4);
  };
  // Shift a month key by n months (negative = back). Rolls over years by itself.
  window.monthShift = (key, n)=>{
    const d = new Date(Number(key.slice(0,4)), Number(key.slice(5,7)) - 1 + n, 1);
    return window.monthKeyOf(d);
  };
  // First/last day of a month key, as ISO dates.
  window.monthBounds = (key)=>{
    const y = Number(key.slice(0,4)), m = Number(key.slice(5,7));
    return { from: `${key}-01`, to: `${key}-${String(new Date(y, m, 0).getDate()).padStart(2,'0')}` };
  };
})();
