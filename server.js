const express = require("express");
const mysql = require("mysql2");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const PORT = 5000;
const JWT_SECRET = "smartstock_secret_key";

const app = express();
app.use(cors());
app.use(express.json());

// ----------------------
// DATABASE CONNECTION
// ----------------------
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "6006",
  database: "stock",
});

db.connect((err) => {
  if (err) {
    console.error("❌ MySQL connection error:", err.message);
    process.exit(1);
  }
  console.log("✅ Connected to MySQL database (stock)");
});

// ----------------------
// AUTH MIDDLEWARE
// ----------------------
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Authorization header missing" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Token missing" });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Invalid or expired token" });
    }
    req.user = decoded; // { id, email }
    next();
  });
}

// ----------------------
// AUTH ROUTES
// ----------------------

// REGISTER
app.post("/api/register", async (req, res) => {
  const { business_name, email, password } = req.body;

  if (!business_name || !email || !password) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const sql =
      "INSERT INTO users (business_name, email, password) VALUES (?, ?, ?)";
    db.query(sql, [business_name, email, hashedPassword], (err) => {
      if (err) {
        if (err.code === "ER_DUP_ENTRY") {
          return res.status(409).json({ message: "User already exists" });
        }
        console.error(err);
        return res.status(500).json({ message: "Database error" });
      }

      res.status(201).json({ message: "Registration successful" });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// LOGIN
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }

  const sql = "SELECT * FROM users WHERE email = ?";
  db.query(sql, [email], async (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Database error" });
    }

    if (results.length === 0) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const user = results[0];
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: "1h",
    });

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        business_name: user.business_name,
        email: user.email,
      },
    });
  });
});

// ----------------------
// PRODUCTS
// ----------------------

// GET PRODUCTS
app.get("/api/products", authenticateToken, (req, res) => {
  const sql = `
    SELECT id, name, price, quantity, low_stock_limit, created_at
    FROM products
    WHERE user_id = ?
    ORDER BY created_at DESC
  `;

  db.query(sql, [req.user.id], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Database error" });
    }
    res.json(results);
  });
});

// ADD PRODUCT
app.post("/api/products", authenticateToken, (req, res) => {
  const { name, price, quantity, low_stock_limit } = req.body;

  if (!name || price == null || quantity == null) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const sql = `
    INSERT INTO products
    (user_id, name, price, quantity, low_stock_limit)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [req.user.id, name.trim(), price, quantity, low_stock_limit ?? 5],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: "Database error" });
      }
      res.status(201).json({ message: "Product added successfully" });
    }
  );
});

// ----------------------
// DASHBOARD
// ----------------------
app.get("/api/dashboard", authenticateToken, (req, res) => {
  const sql = `
    SELECT 
      COUNT(*) AS totalProducts,
      SUM(CASE WHEN quantity <= low_stock_limit THEN 1 ELSE 0 END) AS lowStock
    FROM products
    WHERE user_id = ?
  `;

  db.query(sql, [req.user.id], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Database error" });
    }

    res.json({
      totalProducts: results[0].totalProducts || 0,
      lowStock: results[0].lowStock || 0,
    });
  });
});

// ----------------------
// SALES (FIXED FOR REPORTING)
// ----------------------
app.post("/api/sales", authenticateToken, (req, res) => {
  const { product_id, quantity } = req.body;

  if (!product_id || !quantity || quantity <= 0) {
    return res.status(400).json({ message: "Invalid sale data" });
  }

  db.query(
    "SELECT price, quantity FROM products WHERE id = ? AND user_id = ?",
    [product_id, req.user.id],
    (err, results) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: "Database error" });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: "Product not found" });
      }

      const product = results[0];

      if (quantity > product.quantity) {
        return res.status(400).json({ message: "Not enough stock" });
      }

      const unitPrice = Number(product.price);
      const totalAmount = Number((unitPrice * Number(quantity)).toFixed(2));

      db.query(
        "UPDATE products SET quantity = quantity - ? WHERE id = ? AND user_id = ?",
        [quantity, product_id, req.user.id],
        (err) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ message: "Stock update failed" });
          }

          db.query(
            `INSERT INTO transactions
             (user_id, product_id, type, quantity, unit_price, total_amount)
             VALUES (?, ?, 'SALE', ?, ?, ?)`,
            [req.user.id, product_id, quantity, unitPrice, totalAmount],
            (err) => {
              if (err) {
                console.error(err);
                return res.status(500).json({ message: "Transaction insert failed" });
              }

              res.json({
                message: "Sale recorded successfully",
                unit_price: unitPrice,
                total_amount: totalAmount,
              });
            }
          );
        }
      );
    }
  );
});

// ----------------------
// SALES REPORT (BILLING) with MONTH FILTER
// Supports: ?month=YYYY-MM
// Example: /api/billing/summary?month=2026-01
// ----------------------

// Summary cards
app.get("/api/billing/summary", authenticateToken, (req, res) => {
  const { month } = req.query;

  let sql = `
    SELECT
      COUNT(*) AS totalTransactions,
      COALESCE(SUM(quantity), 0) AS totalUnitsSold,
      COALESCE(SUM(total_amount), 0) AS totalRevenue
    FROM transactions
    WHERE user_id = ?
      AND type = 'SALE'
  `;

  const params = [req.user.id];

  if (month) {
    sql += ` AND DATE_FORMAT(created_at, '%Y-%m') = ?`;
    params.push(month);
  }

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Database error" });
    }

    const row = results[0] || {};
    res.json({
      totalTransactions: row.totalTransactions || 0,
      totalUnitsSold: row.totalUnitsSold || 0,
      totalRevenue: Number(row.totalRevenue || 0),
    });
  });
});

// Transactions list
app.get("/api/billing/transactions", authenticateToken, (req, res) => {
  const { month } = req.query;

  let sql = `
    SELECT
      t.id,
      t.created_at,
      p.name AS product_name,
      t.type,
      t.quantity,
      t.unit_price,
      t.total_amount
    FROM transactions t
    JOIN products p ON p.id = t.product_id
    WHERE t.user_id = ?
      AND t.type = 'SALE'
  `;

  const params = [req.user.id];

  if (month) {
    sql += ` AND DATE_FORMAT(t.created_at, '%Y-%m') = ?`;
    params.push(month);
  }

  sql += ` ORDER BY t.created_at DESC`;

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Database error" });
    }
    res.json(results);
  });
});

// ----------------------
// START SERVER
// ----------------------
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
