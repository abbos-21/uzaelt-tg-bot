import fs from "fs";
import path from "path";
import { Telegraf, Markup } from "telegraf";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import serveIndex from "serve-index";

import cors from "cors";
import express from "express";
const app = express();
app.use(cors());

const uploadsPath = path.join(__dirname, "../uploads");

app.use(
  "/uploads",
  express.static(uploadsPath),
  serveIndex(uploadsPath, { icons: true })
);

// app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.listen(3001, () => {
	console.log("Server is running on port 3001");
})

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN as string);
const prisma = new PrismaClient();
const cardNumber = process.env.CARD_NUMBER;
const adminId = process.env.ADMIN_TELEGRAM_ID as string;
const uploadDir = "./uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const paymentInstructions = `💳 Payment Instructions:
1️⃣ Send <code>800000</code> UZS to: 
<code>${cardNumber}</code>
2️⃣ Save the payment confirmation screenshot 📸
3️⃣ Click "I paid ✅" below
4️⃣ Send the screenshot when prompted

📝 Ensure the screenshot includes:
✔ Amount: 800,000 UZS
✔ Date & Time ⏳
✔ Transaction ID 🔢
✔ Recipient Card Number 💳`;

bot.start(async (ctx) => {
  const { id, first_name, last_name, username } = ctx.from;
  const telegramId = id.toString();
  const fullName = `${first_name} ${last_name || ""}`.trim();
  let user = await prisma.user.findUnique({ where: { telegramId } });

  if (!user) {
    user = await prisma.user.create({
      data: { telegramId, fullName, username },
    });
    return ctx.reply("👋 Welcome! Please share your 📱 phone number:", {
      reply_markup: Markup.keyboard([
        [Markup.button.contactRequest("📞 Share My Phone Number")],
      ])
        .resize()
        .oneTime().reply_markup,
    });
  }

  if (!user.phoneNumber)
    return ctx.reply("📱 Please share your phone number to continue:", {
      reply_markup: Markup.keyboard([
        [Markup.button.contactRequest("📞 Share My Phone Number")],
      ])
        .resize()
        .oneTime().reply_markup,
    });

  if (!user.isSubscribed)
    return ctx.reply(
      `🚀 Activate your subscription by following these steps:

${paymentInstructions}`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          Markup.button.callback("I paid ✅", "button_clicked"),
        ]),
      }
    );

  ctx.reply(`🎉 Welcome back, *${fullName}*! You're already subscribed! ✅`, {
    parse_mode: "Markdown",
  });
});

bot.on("contact", async (ctx) => {
  await prisma.user.update({
    where: { telegramId: ctx.from.id.toString() },
    data: { phoneNumber: ctx.message.contact.phone_number },
  });
  ctx.reply(
    `🚀 Activate your subscription by following these steps:

${paymentInstructions}`,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        Markup.button.callback("I paid ✅", "button_clicked"),
      ]),
    }
  );
});

bot.action("button_clicked", async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply("📸 Please send the screenshot of your payment:");
});

bot.on("photo", async (ctx) => {
  const telegramId = ctx.from.id.toString();
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) return ctx.reply("🚨 Please start the bot using /start");
  if (!user.phoneNumber)
    return ctx.reply("📞 Please share your phone number first!");

  const photo = ctx.message.photo.pop();
  if (!photo) return ctx.reply("❌ Invalid image. Please try again.");

  try {
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const fileName = `${telegramId}_${Date.now()}.jpg`;
    const filePath = path.join(uploadDir, fileName);
    const buffer = await (await fetch(fileLink.href)).arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(buffer));
    await prisma.user.update({
      where: { telegramId },
      data: { receiptImage: filePath },
    });
    ctx.reply(
      "✅ Payment screenshot received! Your subscription is under review. 🕵️‍♂️"
    );

    await bot.telegram.sendPhoto(adminId, photo.file_id, {
      caption: `📢 *New Payment Submitted!*
👤 User: ${user.fullName} (@${user.username || "N/A"})
📞 Phone: ${user.phoneNumber}
🆔 Telegram ID: ${telegramId}

🛠 Click "Verify ✅" to approve subscription.`,
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        Markup.button.callback("Verify ✅", `verify_${telegramId}`),
      ]),
    });
  } catch (error) {
    console.error("Error processing image:", error);
    ctx.reply("❌ Error processing your image. Please try again.");
  }
});

bot.action(/^verify_(.+)$/, async (ctx) => {
  const telegramId = ctx.match[1];
  const user = await prisma.user.update({
    where: { telegramId },
    data: { isSubscribed: true },
  });
  await bot.telegram.sendMessage(
    telegramId,
    "🎉 Your payment is verified! Subscription activated. 🚀"
  );
  await ctx.editMessageCaption(
    `✅ Subscription activated for *${user.fullName}*! 🎊`,
    { parse_mode: "Markdown" }
  );
});

bot.launch();
