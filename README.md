# Crypto Signal v1 (n8n) — موتور قطعی سیگنال کریپتو

ورک‌فلوی n8n که هر ۴ ساعت (دقیقه :35 پس از باز شدن کندل 4H) به‌صورت کاملاً قطعی (بدون تصمیم‌گیری AI) بازار را تحلیل می‌کند و سیگنال را به تلگرام می‌فرستد.

## معماری

Schedule (:35) → ۱۱ نود HTTP (تیکر ۱۰ ارز، کندل 4H برای BTC/ETH/SOL/BNB، فاندینگ، ترس‌وطمع، گلوبال کوین‌گکو) → Merge → Compute Indicators → **Quant Engine** → IF TRADE → Fetch 1D → **Backtest Engine** → Ledger Insert → Narrator (فارسی) → Telegram

شاخه NO_TRADE: Log → Narrator → Telegram

## حلقه خودارزیابی (Signal Tracker)

ورک‌فلوی دوم (`tracker_export.json`، هر ۴ ساعت در :40): هر TRADE در جدول signal_ledger ثبت می‌شود؛ Tracker ردیف‌های OPEN را با قیمت زنده چک می‌کند، روی TP1 یا STOP می‌بندد (با R واقعی) و نتیجه را به تلگرام می‌فرستد. هدف: تنظیم پارامترها (تلاقی، کانفیدنس، RSI veto) با آمار واقعی به‌جای حدس.

## فایل‌ها

- `engines/quant_engine.js` — موتور تصمیم قطعی (رژیم ۶ مؤلفه، ۹ تلاقی، ADX/RSI/BB/ATR، ساخت ورود-استاپ-تارگت از ATR)
- `engines/compute_indicators.js` — اندیکاتورها برای BTC/ETH/SOL/BNB
- `engines/backtest_engine.js` — بک‌تست قطعی روی ۴۰۰ کندل روزانه (کارمزد 5bps + لغزش)
- `engines/narrator_fa.js` — پیام فارسی تلگرام
- `workflow_export.json` — ورک‌فلو اصلی (۳۲ نود)
- `tracker_export.json` — Signal Tracker (۷ نود)

## ایمپورت

n8n → Import from File → هر دو JSON. سپس توکن تلگرام را در نود HTTP تنظیم و Publish کنید.

⚠️ فقط تحلیل است، توصیه مالی نیست.
