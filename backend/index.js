require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();

app.use(express.json({ limit: '4mb' })); // ad-hoc visit photos arrive as base64 (max 2.5 MB)
app.use(cors({ exposedHeaders: ['Content-Disposition'] })); // lets the web/Android app read report file names

// Database: environment variables on Render, local defaults on your laptop
const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'hrms@2026',
  database: process.env.DB_NAME || 'hrms',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  dateStrings: true,
  multipleStatements: true,
  waitForConnections: true,
  connectionLimit: 10,
});

db.getConnection((err, conn) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    return;
  }
  console.log('✅ Connected to MySQL database successfully.');
  conn.release();
});

// Secret Key for JWT
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here';

// Helper function for IST date
const getLocalDateTime = () => {
  const d = new Date();
  const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-CA', options);
  return formatter.format(d);
};

// Authentication Middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token || token === 'undefined' || token === 'null') {
    return res.status(401).json({ error: 'Access denied. No token provided in headers.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Token expired or invalid. Please login again.' });
    }
    
    req.user = decoded;
    const userEmail = decoded?.email;
    if (!userEmail) {
      return res.status(401).json({ error: 'Invalid token payload. Email missing.' });
    }

    db.query('SELECT * FROM users WHERE email = ?', [userEmail], (dbErr, results) => {
      if (dbErr || results.length === 0) {
        return res.status(401).json({ error: 'User not found in database for this token.' });
      }

      const row = { ...results[0] };
      delete row.password;
      const hasGroupAccess = Number(row.group_access || 0) === 1;
      req.dbUser = {
        ...row,
        base_role: row.role,
        base_company_id: row.company_id,
        role: hasGroupAccess ? 'MD' : row.role,
        company_id: hasGroupAccess ? null : row.company_id,
      };
      req.userId = row.id;
      next();
    });
  });
};

// Haversine Formula for Distance Calculation
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// Routes loading (Without _2 mismatch)
const apiRoutes = require('./routes');
// Field attendance first: it replaces /attendance/mark and /attendance/checkout/:id (falls back to routes.js until migrated)
app.use('/api', require('./fieldRoutes')(db, authenticate, getLocalDateTime, calculateDistance));
app.use('/api', apiRoutes(db, authenticate, getLocalDateTime, calculateDistance, JWT_SECRET));
app.use('/api', require('./extraRoutes')(db, authenticate));
// Payroll: salary structures, statutory deductions, runs, bank file, payslips (needs scripts/add-payroll.js)
app.use('/api', require('./payroll/payrollRoutes')(db, authenticate));

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 HRMS Backend Server is running successfully on port ${PORT}`);
});