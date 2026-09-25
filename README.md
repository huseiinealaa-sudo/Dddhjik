# FPV Drone Simulator · محاكي طائرات FPV

**[▶ Play in the browser / العب في المتصفح](https://huseiinealaa-sudo.github.io/Dddhjik/)**

A realistic FPV (first-person view) drone flight simulator that runs in the browser, built with
TypeScript, Vite, Three.js and React. It works on desktop (keyboard, gamepad or an RC radio over
USB) and on iPad Safari with on-screen touch sticks.

محاكي طيران واقعي لطائرات FPV يعمل في المتصفح، مبني بـ TypeScript وVite وThree.js وReact. يعمل على
الحاسوب (لوحة المفاتيح أو يد الألعاب أو جهاز الراديو عبر USB) وعلى متصفح Safari في الآيباد بعصي لمس
على الشاشة.

---

## العربية

### المزايا

- **فيزياء حقيقية بتردد 1000 هرتز**: الجاذبية، ودفع أربعة محركات مستقل مع تأخر استجابة المحرك،
  وانخفاض الدفع مع السرعة، ومقاومة الهواء لجسم الطائرة والمراوح، والعطالة الدورانية والتأثير
  الجيروسكوبي، وتأثير الأرض، واضطراب المراوح (Prop wash) وحلقة الدوامة، والرياح والاضطراب،
  واصطدامات حقيقية مع الأرض والمباني والأشجار والبوابات.
- **بطارية LiPo/Li-ion** بهبوط جهد تحت الحمل واستهلاك mAh حقيقي.
- **متحكّم طيران على نمط Betaflight**: حلقة PID بمقاييس Betaflight، ‏Feed-forward، ‏I-term relax،
  ‏Anti-gravity، ‏TPA، ‏Air mode، ومعدّلات Betaflight وActual.
- **أوضاع الطيران**: ‏Angle (تسوية ذاتية للمبتدئين)، ‏Horizon، ‏Acro (للمحترفين)، ووضع السلحفاة
  لقلب الطائرة بعد السقوط.
- **أربع طائرات**: فري ستايل 5 إنش، سباق 5 إنش، سينيووب 3 إنش، مدى بعيد 7 إنش.
- **عالم ثلاثي الأبعاد**: مرج بالعشب والأشجار، وبحيرة، وجبال، وساحة صناعية بمبنى مهجور وممر حاويات
  وبرج ومستودع.
- **سباقات** على ثلاث حلبات مع عدّ تنازلي وتوقيت لكل بوابة وأرقام قياسية وسباق ضد "شبح" أفضل لفة.
- **تدريبات**: التحويم، والهبوط الدقيق، والدوران حول عمود.
- **كاميرات**: ‏FPV مع ميل الكاميرا وتشوّه العدسة الواسعة، ومطاردة، وخط البصر. مظهر بث فيديو نقي
  أو رقمي أو تناظري مع ضعف الإشارة عند الابتعاد.
- **واجهة** بالعربية والإنجليزية، وشاشة OSD بأسلوب Betaflight (الجهد، البطارية، السرعة، الارتفاع،
  حالة التسليح).

### التشغيل محليًا

```bash
npm install
npm run dev
```

ثم افتح الرابط الذي يظهر (عادة `http://localhost:5173`). لتجربته على الآيباد من الشبكة نفسها افتح
عنوان الشبكة الذي يطبعه Vite.

أوامر أخرى:

```bash
npm run build     # فحص الأنواع ثم بناء نسخة الإنتاج في dist/
npm run preview   # معاينة نسخة الإنتاج
npm test          # اختبارات الفيزياء ومتحكّم الطيران ومنطق السباق
```

### التحكم

| الإجراء | لوحة المفاتيح | اللمس |
| --- | --- | --- |
| الخانق | W / S | العصا اليسرى (أعلى/أسفل) — لا ترتدّ |
| الانعراج | A / D | العصا اليسرى (يمين/يسار) |
| الانحدار / الدحرجة | الأسهم | العصا اليمنى |
| تسليح / فصل | Space | زر «تسليح» |
| تغيير الوضع | M | زر «الوضع» |
| الكاميرا | C | زر الكاميرا |
| إعادة | R | زر الإعادة |
| وضع السلحفاة | T | يظهر عند انقلاب الطائرة |
| إيقاف مؤقت | Esc | زر الإيقاف |

للتسليح يجب أن يكون الخانق في الأسفل. يمكن تغيير نمط جهاز التحكم (Mode 1–4) وحجم العصي من الإعدادات،
كما يمكن توصيل يد ألعاب أو جهاز راديو (EdgeTX/OpenTX) وتعيين القنوات ومعايرتها.

**نصيحة للآيباد:** افتح الرابط في Safari ثم «مشاركة ← إضافة إلى الشاشة الرئيسية» ليعمل بملء الشاشة.

### النشر على GitHub Pages

يقوم ملف `.github/workflows/deploy.yml` بفحص الأنواع وتشغيل الاختبارات والبناء ثم النشر تلقائيًا عند
كل دفع. يلزم تفعيل Pages مرة واحدة من: **Settings ← Pages ← Source: GitHub Actions**.
يأخذ `vite.config.ts` المسار الأساسي من المتغير `VITE_BASE` (اسم المستودع في الـ CI، و`./` محليًا).

---

## English

### Features

- **1 kHz rigid-body physics**: gravity, four independently simulated motors with spin-up lag,
  thrust that falls off with airspeed, body and rotor drag, rotational inertia and gyroscopic
  effects, ground effect, prop wash / vortex ring state, wind with gusts and turbulence, and real
  collisions with terrain, buildings, trees and gates.
- **LiPo / Li-ion battery** model with voltage sag under load and mAh consumption.
- **Betaflight-style flight controller**: PID loop on Betaflight's scaling, feed-forward, I-term
  relax, anti-gravity, TPA, air mode, Betaflight and Actual rates.
- **Flight modes**: Angle (self-levelling, for beginners), Horizon, Acro (rate mode), plus Turtle
  mode to flip back over after a crash.
- **Four airframes**: 5" freestyle, 5" racer, 3" cinewhoop, 7" long range.
- **3D world**: meadow with grass and trees, a lake, mountains, and an industrial yard with an
  abandoned building, container canyon, lattice tower and warehouse.
- **Racing** on three tracks: countdown, per-gate splits, lap records and a best-lap ghost.
- **Training drills**: hover, precision landing, orbit.
- **Cameras**: FPV with uptilt and wide-angle lens distortion, chase, and line of sight. Clean,
  digital HD or analog video look, with break-up as the link weakens.
- **Arabic and English UI** and a Betaflight-style OSD (voltage, battery, speed, altitude, arm state).

### Run locally

```bash
npm install
npm run dev
```

Open the printed URL (usually `http://localhost:5173`). To try it on an iPad on the same network,
open the network URL Vite prints.

```bash
npm run build     # type-check and build the production bundle into dist/
npm run preview   # serve the production build
npm test          # physics, flight-controller and race-logic tests
```

### Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Throttle | W / S | Left stick up/down (stays put) |
| Yaw | A / D | Left stick left/right |
| Pitch / roll | Arrow keys | Right stick |
| Arm / disarm | Space | ARM button |
| Flight mode | M | Mode button |
| Camera | C | Camera button |
| Reset | R | Reset button |
| Turtle mode | T | Appears when upside down |
| Pause | Esc | Pause button |

Throttle must be at zero to arm. Transmitter mode (1–4), stick size and more are in Settings; a
gamepad or an RC radio in USB-joystick mode can be bound and calibrated there.

### Deploying to GitHub Pages

`.github/workflows/deploy.yml` type-checks, runs the tests, builds and deploys on every push.
Enable Pages once under **Settings → Pages → Source: GitHub Actions**. `vite.config.ts` reads the
base path from `VITE_BASE` (the repository name in CI, `./` locally).

### Project layout

```
src/sim/      physics, battery, wind, collisions, flight controller (no rendering; unit tested)
src/input/    touch / keyboard / gamepad / RC radio input
src/engine/   Three.js world, drone model, cameras, post-processing
src/game/     game loop, race & drill logic, audio, settings
src/ui/       React interface, OSD, touch sticks, translations
tests/        Vitest tests
```
