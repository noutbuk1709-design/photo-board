// api/upload.js
import formidable from "formidable";
import fs from "fs";

export const config = { api: { bodyParser: false } };

const IMGBB_KEY = process.env.IMGBB_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

async function githubGetFile(filepath = "data.json") {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(filepath)}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, "User-Agent": "photo-board-app" },
  });
  if (res.status === 404) return { content: "W10K", sha: null };
  if (!res.ok) throw new Error("GitHub GET failed: " + (await res.text()));
  return res.json();
}

async function githubPutFile(filepath = "data.json", contentBase64, sha = null, message = "Update data.json") {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(filepath)}`, {
    method: "PUT",
    headers: { Authorization: `token ${GITHUB_TOKEN}`, "User-Agent": "photo-board-app", "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: contentBase64, sha }),
  });
  if (!res.ok) throw new Error("GitHub PUT failed: " + (await res.text()));
  return res.json();
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const file = await githubGetFile("data.json");
      if (!file || !file.content) return res.json([]);
      const raw = Buffer.from(file.content, "base64").toString("utf8");
      return res.json(JSON.parse(raw || "[]"));
    }

    if (req.method === "POST") {
      const form = new formidable.IncomingForm();
      form.parse(req, async (err, fields, files) => {
        if (err) return res.status(500).json({ error: "Form parse error" });

        const description = (fields.description || "").toString();
        const file = files.photo;
        if (!file) return res.status(400).json({ error: "No file" });

        const buffer = fs.readFileSync(file.filepath);
        const base64 = buffer.toString("base64");

        const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_KEY}`, {
          method: "POST",
          body: new URLSearchParams({ image: base64 }),
        });
        const imgbbJson = await imgbbRes.json();
        if (!imgbbJson.success) return res.status(500).json({ error: "imgbb upload failed", detail: imgbbJson });

        const imageUrl = imgbbJson.data.url;

        const fileObj = await githubGetFile("data.json");
        let arr = [], sha = null;
        if (fileObj && fileObj.content) {
          arr = JSON.parse(Buffer.from(fileObj.content, "base64").toString("utf8") || "[]");
          sha = fileObj.sha;
        }

        const newPost = {
          id: Date.now(),
          description,
          imageUrl,
          created_at: new Date().toISOString(),
        };
        arr.unshift(newPost);

        const newContent = Buffer.from(JSON.stringify(arr, null, 2)).toString("base64");
        await githubPutFile("data.json", newContent, sha, `Add post ${newPost.id}`);

        return res.json({ ok: true, post: newPost });
      });
      return;
    }

    if (req.method === "DELETE") {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const id = parseInt(url.searchParams.get("id"));
      if (!id) return res.status(400).json({ error: "No id provided" });

      const fileObj = await githubGetFile("data.json");
      if (!fileObj || !fileObj.content) return res.status(404).json({ error: "Data not found" });

      let arr = JSON.parse(Buffer.from(fileObj.content, "base64").toString("utf8") || "[]");
      const index = arr.findIndex(p => p.id === id);
      if (index === -1) return res.status(404).json({ error: "Post not found" });

      arr.splice(index, 1);

      const newContent = Buffer.from(JSON.stringify(arr, null, 2)).toString("base64");
      await githubPutFile("data.json", newContent, fileObj.sha, `Delete post ${id}`);

      return res.json({ ok: true });
    }

    res.setHeader("Allow", "GET,POST,DELETE");
    res.status(405).end("Method Not Allowed");
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
