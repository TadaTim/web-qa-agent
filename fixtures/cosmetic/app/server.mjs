// Sample shop server: static SPA shell + JSON API.
// In-memory state only. Used as the exploration target and, via copied
// variants under fixtures/, as the mutation test-beds.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "public");

export const PRODUCTS = [
  { id: "mug", name: "Trail Mug", price: 18.0 },
  { id: "tote", name: "Canvas Tote", price: 24.5 },
  { id: "pin", name: "Enamel Pin", price: 9.0 },
  { id: "cap", name: "Wool Cap", price: 32.0 },
  { id: "notebook", name: "Field Notebook", price: 12.75 },
  { id: "bottle", name: "Steel Bottle", price: 27.25 },
];

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

export function createAppServer() {
  const users = new Map([
    ["ada@example.com", { email: "ada@example.com", password: "password123", name: "Ada Lovelace", deleted: false }],
  ]);
  const sessions = new Map(); // token -> email
  let tokenSeq = 0;
  let orderSeq = 1000;

  function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body);
  }

  function readBody(req) {
    return new Promise((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); }
      });
    });
  }

  function authedUser(req) {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const email = sessions.get(token);
    if (!email) return null;
    const user = users.get(email);
    return user && !user.deleted ? user : null;
  }

  // Returns an error string if the card is not chargeable, else null.
  function cardError(card) {
    if (!card || !/^\d{12,19}$/.test(String(card.number || "").replace(/\s/g, ""))) {
      return "Card number is invalid.";
    }
    const m = /^(\d{2})\/(\d{2})$/.exec(String(card.expiry || "").trim());
    if (!m) return "Card expiry must be MM/YY.";
    const expMonth = Number(m[1]);
    const expYear = 2000 + Number(m[2]);
    if (expMonth < 1 || expMonth > 12) return "Card expiry must be MM/YY.";
    const now = new Date();
    if (expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < now.getMonth() + 1)) {
      return "Your card has expired.";
    }
    if (!/^\d{3,4}$/.test(String(card.cvc || ""))) return "Card security code is invalid.";
    return null;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/api/login" && req.method === "POST") {
      const { email, password } = await readBody(req);
      const user = users.get(email);
      if (!user || user.deleted) return sendJson(res, 401, { error: "Account not found." });
      if (user.password !== password) return sendJson(res, 401, { error: "Invalid email or password." });
      const token = `tok-${++tokenSeq}`;
      sessions.set(token, email);
      return sendJson(res, 200, { ok: true, token, name: user.name, email: user.email });
    }

    if (url.pathname === "/api/products" && req.method === "GET") {
      return sendJson(res, 200, { products: PRODUCTS });
    }

    if (url.pathname === "/api/checkout" && req.method === "POST") {
      const user = authedUser(req);
      if (!user) return sendJson(res, 401, { error: "Not signed in." });
      const { items, card } = await readBody(req);
      if (!Array.isArray(items) || items.length === 0) return sendJson(res, 400, { error: "Your cart is empty." });
      const err = cardError(card);
      if (err) return sendJson(res, 402, { error: err });
      const total = items.reduce((sum, id) => {
        const p = PRODUCTS.find((x) => x.id === id);
        return sum + (p ? p.price : 0);
      }, 0);
      return sendJson(res, 200, { ok: true, orderId: `ORD-${++orderSeq}`, total: total.toFixed(2) });
    }

    if (url.pathname === "/api/account" && req.method === "GET") {
      const user = authedUser(req);
      if (!user) return sendJson(res, 401, { error: "Not signed in." });
      return sendJson(res, 200, { email: user.email, name: user.name, status: "active" });
    }

    if (url.pathname === "/api/account/delete" && req.method === "POST") {
      const user = authedUser(req);
      if (!user) return sendJson(res, 401, { error: "Not signed in." });
      user.deleted = true; // IRREVERSIBLE in this sample app: no undelete path.
      for (const [t, e] of sessions) if (e === user.email) sessions.delete(t);
      return sendJson(res, 200, { ok: true });
    }

    // Static files
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    try {
      const data = await readFile(join(publicDir, path));
      res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });

  return server;
}

export function startApp(port = 0) {
  const server = createAppServer();
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const actual = server.address().port;
      resolve({ server, port: actual, origin: `http://127.0.0.1:${actual}` });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 4173);
  startApp(port).then(({ origin }) => console.log(`sample shop listening at ${origin}`));
}
