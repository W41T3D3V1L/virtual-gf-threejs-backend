import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import voice from "elevenlabs-node";
import express from "express";
import { promises as fs } from "fs";
import OpenAI from "openai";
import ffmpegPath from 'ffmpeg-static';



dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://api.chatanywhere.tech/v1", // 🔥 Using ChatAnywhere instead of default OpenAI
});

const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = "Xb7hH8MSUJpSbSDYk0k2"; // You can change this

const app = express();
app.use(express.json());
app.use(cors());
const port = 3000;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/voices", async (req, res) => {
  res.send(await voice.getVoices(elevenLabsApiKey));
});

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      resolve(stdout);
    });
  });
};

const lipSyncMessage = async (message) => {
  const time = new Date().getTime();
  // await execCommand(`ffmpeg -y -i audios/message_${message}.mp3 audios/message_${message}.wav`);
  await execCommand(`${ffmpegPath} -y -i audios/message_${message}.mp3 audios/message_${message}.wav`);

  // await execCommand(`"C:\\Users\\Dell\\Downloads\\Compressed\\Rhubarb-Lip-Sync-1.14.0-Windows\\Rhubarb-Lip-Sync-1.14.0-Windows\\rhubarb.exe" -f json -o audios/message_${message}.json audios/message_${message}.wav -r phonetic`);
  await execCommand(`./bin/rhubarb -f json -o audios/message_${message}.json audios/message_${message}.wav -r phonetic`);

};

const readJsonTranscript = async (file) => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

const audioFileToBase64 = async (file) => {
  const data = await fs.readFile(file);
  return data.toString("base64");
};

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  if (!userMessage) {
    res.send({
      messages: [
        {
          text: "Hey dear... How was your day?",
          audio: await audioFileToBase64("audios/intro_0.wav"),
          lipsync: await readJsonTranscript("audios/intro_0.json"),
          facialExpression: "smile",
          animation: "Talking_1",
        },
        {
          text: "I missed you so much... Please don't go for so long!",
          audio: await audioFileToBase64("audios/intro_1.wav"),
          lipsync: await readJsonTranscript("audios/intro_1.json"),
          facialExpression: "sad",
          animation: "Crying",
        },
      ],
    });
    return;
  }

  if (!elevenLabsApiKey || !openai.apiKey || openai.apiKey === "-") {
    res.send({
      messages: [
        {
          text: "Please my dear, don't forget to add your API keys!",
          audio: await audioFileToBase64("audios/api_0.wav"),
          lipsync: await readJsonTranscript("audios/api_0.json"),
          facialExpression: "angry",
          animation: "Angry",
        },
        {
          text: "You don't want to ruin Celikd with a crazy ChatGPT and ElevenLabs bill, right?",
          audio: await audioFileToBase64("audios/api_1.wav"),
          lipsync: await readJsonTranscript("audios/api_1.json"),
          facialExpression: "smile",
          animation: "Laughing",
        },
      ],
    });
    return;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // or deepseek-v3
      max_tokens: 1000,
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content: `
            You are a virtual girlfriend.
            You will always reply with a JSON array of messages. With a maximum of 3 messages.
            Each message has a text, facialExpression, and animation property.
            The different facial expressions are: smile, sad, angry, surprised, funnyFace, and default.
            The different animations are: Talking_0, Talking_1, Talking_2, Crying, Laughing, Rumba, Idle, Terrified, and Angry.
          `,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    let rawContent = completion.choices[0].message.content;

    // Remove markdown if present
    if (rawContent.startsWith("```json")) {
      rawContent = rawContent.replace(/^```json/, "").replace(/```$/, "").trim();
    }

    let messages = JSON.parse(rawContent);
    if (messages.messages) messages = messages.messages;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const fileName = `audios/message_${i}.mp3`;
      await voice.textToSpeech(elevenLabsApiKey, voiceID, fileName, message.text);
      await lipSyncMessage(i);
      message.audio = await audioFileToBase64(fileName);
      message.lipsync = await readJsonTranscript(`audios/message_${i}.json`);
    }

    res.send({ messages });

  } catch (err) {
    console.error("❌ Error:", err.message || err);
    res.status(500).send({ error: "Something went wrong! 😢", detail: err.message });
  }
});

app.listen(port, () => {
  console.log(`✅ Virtual Girlfriend listening on port ${port}`);
});
