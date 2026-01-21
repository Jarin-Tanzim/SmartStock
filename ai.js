/**
 * ai.js
 * AI Insights routes using Groq
 */

require("dotenv").config();
const Groq = require("groq-sdk");

module.exports = function (app, db, authenticateToken) {
  // -------------------------
  // GROQ CLIENT
  // -------------------------
  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
  });

  // -------------------------
  // PROMISE-BASED DB QUERY
  // -------------------------
  function query(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.query(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // -------------------------
  // AI INSIGHTS ENDPOINT
  // -------------------------
  app.get("/api/ai/insights", authenticateToken, async (req, res) => {
    try {
      // ENV CHECK
      if (!process.env.GROQ_API_KEY) {
        return res.status(500).json({
          message: "GROQ_API_KEY missing in .env",
        });
      }

      // -------------------------
      // FETCH BUSINESS DATA
      // -------------------------
      const products = await query(
        `SELECT name, price, quantity, low_stock_limit
         FROM products
         WHERE user_id = ?`,
        [req.user.id]
      );

      const monthlySales = await query(
        `SELECT
           DATE_FORMAT(created_at, '%Y-%m') AS month,
           SUM(total_amount) AS revenue
         FROM transactions
         WHERE user_id = ?
           AND type = 'SALE'
         GROUP BY month
         ORDER BY month`,
        [req.user.id]
      );

      const topProducts = await query(
        `SELECT
           p.name,
           SUM(t.quantity) AS units_sold,
           SUM(t.total_amount) AS revenue
         FROM products p
         JOIN transactions t ON t.product_id = p.id
         WHERE p.user_id = ?
           AND t.type = 'SALE'
         GROUP BY p.name
         ORDER BY revenue DESC
         LIMIT 5`,
        [req.user.id]
      );

      // -------------------------
      // AI PROMPT
      // -------------------------
      const prompt = `
You are an AI business analyst helping a small business increase future sales.

Analyze the data and return STRICT JSON only (no markdown, no explanation).

Format:
{
  "summary": "short overview",
  "recommendations": [
    { "title": "", "why": "", "action": "", "priority": "HIGH|MEDIUM|LOW" }
  ],
  "restock": [
    { "product": "", "suggested_qty": number, "reason": "" }
  ],
  "forecast": {
    "next_month_revenue": "$min - $max",
    "logic": "short explanation"
  }
}

DATA:
Products: ${JSON.stringify(products)}
Monthly Sales: ${JSON.stringify(monthlySales)}
Top Products: ${JSON.stringify(topProducts)}
`;

      // -------------------------
      // GROQ API CALL (WITH TIMEOUT)
      // -------------------------
      const completion = await Promise.race([
        groq.chat.completions.create({
          model: "llama-3.1-8b-instant",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.4,
          max_tokens: 700,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("AI request timeout")), 25000)
        ),
      ]);

      const text = completion.choices[0].message.content;

      // -------------------------
      // SAFE JSON PARSE
      // -------------------------
      try {
        const json = JSON.parse(text);
        return res.json(json);
      } catch (parseError) {
        console.error("JSON PARSE ERROR:", text);
        return res.json({
          error: "AI response not valid JSON",
          raw: text,
        });
      }
    } catch (err) {
      console.error("AI ERROR:", err.message);
      return res.status(500).json({
        message: "AI analysis failed",
      });
    }
  });
};
