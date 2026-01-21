require("dotenv").config();
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
  password: "1234",
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
  if (!authHeader) return res.status(401).json({ message: "Authorization header missing" });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Token missing" });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: "Invalid or expired token" });
    req.user = decoded; // { id, email }
    next();
  });
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
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

    const sql = "INSERT INTO users (business_name, email, password) VALUES (?, ?, ?)";
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

  const p = toNumber(price);
  const q = toNumber(quantity);
  const limit = low_stock_limit == null ? 5 : toNumber(low_stock_limit);

  if (!isNonEmptyString(name) || p == null || q == null) {
    return res.status(400).json({ message: "Missing or invalid fields" });
  }

  const sql = `
    INSERT INTO products
    (user_id, name, price, quantity, low_stock_limit)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.query(sql, [req.user.id, name.trim(), p, q, limit ?? 5], (err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Database error" });
    }
    res.status(201).json({ message: "Product added successfully" });
  });
});

// UPDATE PRODUCT (Edit)
app.put("/api/products/:id", authenticateToken, (req, res) => {
  const productId = Number(req.params.id);
  const { name, price, quantity, low_stock_limit } = req.body;

  if (!Number.isFinite(productId)) {
    return res.status(400).json({ message: "Invalid product id" });
  }

  const fields = [];
  const params = [];

  if (name != null) {
    if (!isNonEmptyString(name)) return res.status(400).json({ message: "Invalid name" });
    fields.push("name = ?");
    params.push(name.trim());
  }
  if (price != null) {
    const p = toNumber(price);
    if (p == null || p < 0) return res.status(400).json({ message: "Invalid price" });
    fields.push("price = ?");
    params.push(p);
  }
  if (quantity != null) {
    const q = toNumber(quantity);
    if (q == null || q < 0) return res.status(400).json({ message: "Invalid quantity" });
    fields.push("quantity = ?");
    params.push(q);
  }
  if (low_stock_limit != null) {
    const l = toNumber(low_stock_limit);
    if (l == null || l < 0) return res.status(400).json({ message: "Invalid low_stock_limit" });
    fields.push("low_stock_limit = ?");
    params.push(l);
  }

  if (!fields.length) {
    return res.status(400).json({ message: "No fields to update" });
  }

  const sql = `
    UPDATE products
    SET ${fields.join(", ")}
    WHERE id = ? AND user_id = ?
  `;

  params.push(productId, req.user.id);

  db.query(sql, params, (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Database error" });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json({ message: "Product updated successfully" });
  });
});

// DELETE PRODUCT
app.delete("/api/products/:id", authenticateToken, (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isFinite(productId)) {
    return res.status(400).json({ message: "Invalid product id" });
  }

  // First delete transactions for this product (optional but clean)
  db.query(
    "DELETE FROM transactions WHERE user_id = ? AND product_id = ?",
    [req.user.id, productId],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: "Database error" });
      }

      db.query(
        "DELETE FROM products WHERE id = ? AND user_id = ?",
        [productId, req.user.id],
        (err2, result) => {
          if (err2) {
            console.error(err2);
            return res.status(500).json({ message: "Database error" });
          }
          if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Product not found" });
          }
          res.json({ message: "Product deleted successfully" });
        }
      );
    }
  );
});

// ----------------------
// DASHBOARD (Enhanced)
// ----------------------
app.get("/api/dashboard", authenticateToken, (req, res) => {
  const monthSql = `
    SELECT COALESCE(SUM(total_amount), 0) AS monthlySales
    FROM transactions
    WHERE user_id = ?
      AND type = 'SALE'
      AND DATE_FORMAT(created_at, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')
  `;

  const productsSql = `
    SELECT
      COUNT(*) AS totalProducts,
      SUM(CASE WHEN quantity <= low_stock_limit THEN 1 ELSE 0 END) AS lowStock
    FROM products
    WHERE user_id = ?
  `;

  const lowStockListSql = `
    SELECT id, name, quantity, low_stock_limit
    FROM products
    WHERE user_id = ?
      AND quantity <= low_stock_limit
    ORDER BY (low_stock_limit - quantity) DESC, created_at DESC
    LIMIT 5
  `;

  const trendSql = `
    SELECT DATE(created_at) AS day, COALESCE(SUM(total_amount), 0) AS total
    FROM transactions
    WHERE user_id = ?
      AND type = 'SALE'
      AND created_at >= (NOW() - INTERVAL 6 DAY)
    GROUP BY DATE(created_at)
    ORDER BY day ASC
  `;

  db.query(productsSql, [req.user.id], (err, productsResults) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Database error" });
    }

    db.query(monthSql, [req.user.id], (err2, monthResults) => {
      if (err2) {
        console.error(err2);
        return res.status(500).json({ message: "Database error" });
      }

      db.query(lowStockListSql, [req.user.id], (err3, lowList) => {
        if (err3) {
          console.error(err3);
          return res.status(500).json({ message: "Database error" });
        }

        db.query(trendSql, [req.user.id], (err4, trendRows) => {
          if (err4) {
            console.error(err4);
            return res.status(500).json({ message: "Database error" });
          }

          const row = productsResults[0] || {};
          const monthlySales = Number((monthResults[0] || {}).monthlySales || 0);

          res.json({
            totalProducts: row.totalProducts || 0,
            lowStock: row.lowStock || 0,
            monthlySales,
            lowStockProducts: lowList || [],
            salesTrend7Days: trendRows || [],
          });
        });
      });
    });
  });
});

// ----------------------
// SALES (Stock OUT)
// ----------------------
app.post("/api/sales", authenticateToken, (req, res) => {
  const { product_id, quantity } = req.body;

  const pid = toNumber(product_id);
  const q = toNumber(quantity);

  if (!pid || !q || q <= 0) {
    return res.status(400).json({ message: "Invalid sale data" });
  }

  db.query(
    "SELECT price, quantity FROM products WHERE id = ? AND user_id = ?",
    [pid, req.user.id],
    (err, results) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: "Database error" });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: "Product not found" });
      }

      const product = results[0];

      if (q > product.quantity) {
        return res.status(400).json({ message: "Not enough stock" });
      }

      const unitPrice = Number(product.price);
      const totalAmount = Number((unitPrice * q).toFixed(2));

      db.query(
        "UPDATE products SET quantity = quantity - ? WHERE id = ? AND user_id = ?",
        [q, pid, req.user.id],
        (err2) => {
          if (err2) {
            console.error(err2);
            return res.status(500).json({ message: "Stock update failed" });
          }

          db.query(
            `INSERT INTO transactions
             (user_id, product_id, type, quantity, unit_price, total_amount)
             VALUES (?, ?, 'SALE', ?, ?, ?)`,
            [req.user.id, pid, q, unitPrice, totalAmount],
            (err3) => {
              if (err3) {
                console.error(err3);
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
// PURCHASES (Stock IN)
// ----------------------
app.post("/api/purchases", authenticateToken, (req, res) => {
  const { product_id, quantity, unit_price } = req.body;

  const pid = toNumber(product_id);
  const q = toNumber(quantity);
  const up = unit_price == null ? null : toNumber(unit_price);

  if (!pid || !q || q <= 0) {
    return res.status(400).json({ message: "Invalid purchase data" });
  }

  db.query(
    "SELECT price FROM products WHERE id = ? AND user_id = ?",
    [pid, req.user.id],
    (err, results) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: "Database error" });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: "Product not found" });
      }

      const defaultPrice = Number(results[0].price);
      const unitPrice = up == null ? defaultPrice : Number(up);

      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return res.status(400).json({ message: "Invalid unit_price" });
      }

      const totalAmount = Number((unitPrice * q).toFixed(2));

      db.query(
        "UPDATE products SET quantity = quantity + ? WHERE id = ? AND user_id = ?",
        [q, pid, req.user.id],
        (err2) => {
          if (err2) {
            console.error(err2);
            return res.status(500).json({ message: "Stock update failed" });
          }

          db.query(
            `INSERT INTO transactions
             (user_id, product_id, type, quantity, unit_price, total_amount)
             VALUES (?, ?, 'PURCHASE', ?, ?, ?)`,
            [req.user.id, pid, q, unitPrice, totalAmount],
            (err3) => {
              if (err3) {
                console.error(err3);
                return res.status(500).json({ message: "Transaction insert failed" });
              }

              res.json({
                message: "Purchase recorded successfully",
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
// ----------------------
// ANALYTICS (Monthly Sales)
// ----------------------
app.get("/api/analytics/monthly-sales", authenticateToken, (req, res) => {
  const sql = `
    SELECT
      DATE_FORMAT(MIN(created_at), '%b') AS month,
      MONTH(created_at) AS monthIndex,
      COALESCE(SUM(total_amount), 0) AS revenue
    FROM transactions
    WHERE user_id = ?
      AND type = 'SALE'
      AND YEAR(created_at) = YEAR(CURDATE())
    GROUP BY MONTH(created_at)
    ORDER BY monthIndex
  `;

  db.query(sql, [req.user.id], (err, results) => {
    if (err) {
      console.error("Monthly analytics error:", err);
      return res.status(500).json({ message: "Analytics query failed" });
    }
    res.json(results);
  });
});
require("./ai")(app, db, authenticateToken);

// ----------------------
// START SERVER
// ----------------------
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

