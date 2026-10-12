/* ==========================================================================
   Extra API routes (mounted in index.js next to routes.js):
     GET /api/auth/me          the signed-in user's current profile and access
     GET /api/notifications    recent items for the header bell, scoped by role
   ========================================================================== */
const express = require('express');

module.exports = function extraRoutes(db, authenticate) {
  const router = express.Router();

  const q = (sql, params = []) => new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
  
  const qSafe = (sql, params) => q(sql, params).catch((err) => {
    console.warn('Notifications query skipped:', err.message);
    return [];
  });

  const ROLE_MATCH = ['MD', 'CEO', 'HR', 'ADMIN'];
  const scopeOf = (dbUser) => {
    const role = String(dbUser?.role || '').toUpperCase();
    const companyId = dbUser?.company_id;
    const noCompany = !companyId || Number(companyId) === 0;
    if ((role.includes('MD') || role.includes('ADMIN')) && noCompany) return 'all';
    if (ROLE_MATCH.some((r) => role.includes(r)) && !noCompany) return Number(companyId);
    return null;
  };
  const isGroupMD = (dbUser) => scopeOf(dbUser) === 'all';
  const canEditRecords = (dbUser) => {
    const role = String(dbUser?.role || '').toUpperCase();
    return isGroupMD(dbUser) || role.includes('CEO');
  };

  const kindOf = (type) => {
    const t = String(type || '').toUpperCase();
    if (/\bWFH\b|WORK\s*FROM\s*HOME/.test(t)) return 'Work From Home';
    if (/\bOD\b|ON[\s-]*DUTY/.test(t)) return 'On-Duty';
    return 'leave';
  };

  const dateOnly = (v) => {
    if (!v) return '';
    const s = String(v);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
  };

  // ---------- GET /auth/me ----------
  router.get('/auth/me', authenticate, (req, res) => {
    const u = req.dbUser || {};
    db.query(
      'SELECT u.*, c.name AS company_name FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = ?',
      [req.userId],
      (err, rows) => {
        if (err || !rows?.length) return res.status(404).json({ error: 'User not found' });
        const row = rows[0];
        res.json({
          user: {
            id: row.id,
            emp_code: row.emp_code,
            name: row.name,
            email: row.email,
            role: row.role,
            department: row.department || '',
            joining_date: row.joining_date || '',
            dob: row.dob || '',
            phone: row.phone,
            company_id: row.company_id,
            company_name: row.company_name,
            attendance_type: row.attendance_type,
            attendance_mode: row.attendance_mode || 'OFFICE',
            group_access: Number(row.group_access || 0) === 1,
            access_role: u.role,
          },
        });
      }
    );
  });

  // ---------- GET /notifications ----------
  router.get('/notifications', authenticate, async (req, res) => {
    const me = req.dbUser || {};
    const scope = scopeOf(me);
    const companyFilter = scope && scope !== 'all' ? scope : null;
    const items = [];

    try {
      // Pending requests for whoever decides them: the group MD (all companies) or a company CEO (own company)
      const role = String(me.role || '').toUpperCase();
      const approveScope = isGroupMD(me) ? 'all' : (role.includes('CEO') || role.includes('MD')) && scope && scope !== 'all' ? scope : null;
      if (approveScope) {
        const rows = await qSafe(`
          SELECT l.*, u.name AS employee_name, COALESCE(c.name, 'Unassigned') AS company_name
          FROM leaves l
          JOIN users u ON u.id = l.employee_id
          LEFT JOIN companies c ON c.id = u.company_id
          WHERE l.status = 'Pending' AND l.employee_id <> ? ${approveScope === 'all' ? '' : 'AND u.company_id = ?'}
          ORDER BY l.id DESC LIMIT 15`, approveScope === 'all' ? [req.userId] : [req.userId, approveScope]);
        rows.forEach((l) => {
          const from = dateOnly(l.from_date || l.start_date);
          const to = dateOnly(l.to_date || l.end_date);
          items.push({
            id: `leave-pending-${l.id}`,
            type: 'leave',
            title: `${l.employee_name} requested ${kindOf(l.leave_type || l.type)}`,
            text: `${l.leave_type || l.type || 'Leave'} · ${from}${to && to !== from ? ` to ${to}` : ''} · ${l.company_name}`,
            date: dateOnly(l.created_at) || from,
            target: 'Leave Approvals',
            tone: 'warning',
          });
        });
      }

      if (scope) {
        const rows = await qSafe(`
          SELECT a.*, u.name AS employee_name
          FROM approvals a
          LEFT JOIN users u ON u.id = a.employee_id
          WHERE a.status = 'Pending' ${companyFilter ? 'AND u.company_id = ?' : ''}
          ORDER BY a.id DESC LIMIT 10`, companyFilter ? [companyFilter] : []);
        rows.forEach((a) => {
          items.push({
            id: `approval-pending-${a.id}`,
            type: 'approval',
            title: `${a.request_type || 'Request'} awaiting approval`,
            text: `${a.employee_name || 'Employee'}${a.details ? ` · ${String(a.details).slice(0, 80)}` : ''}`,
            date: dateOnly(a.created_at),
            target: 'Approvals',
            tone: 'warning',
          });
        });
      }

      if (canEditRecords(me)) {
        const rows = await qSafe(`
          SELECT COUNT(*) AS n FROM users
          WHERE UPPER(COALESCE(role, '')) <> 'MD' AND COALESCE(group_access, 0) = 0
            ${companyFilter ? 'AND company_id = ?' : ''}
            AND (COALESCE(monthly_salary, 0) = 0 OR bank_name IS NULL OR bank_name = ''
                 OR department IS NULL OR department = '')`, companyFilter ? [companyFilter] : []);
        const n = Number(rows?.[0]?.n || 0);
        if (n > 0) {
          items.push({
            id: `profiles-incomplete-${n}`,
            type: 'task',
            title: `${n} employee ${n === 1 ? 'profile needs' : 'profiles need'} details`,
            text: 'Department, salary or bank details have not been entered yet.',
            date: '',
            target: 'Employees Management',
            tone: 'info',
          });
        }
      }

      const own = await qSafe(`
        SELECT * FROM leaves
        WHERE employee_id = ? AND status IN ('Approved', 'Rejected')
        ORDER BY id DESC LIMIT 5`, [req.userId]);
      own.forEach((l) => {
        const from = dateOnly(l.from_date || l.start_date);
        items.push({
          id: `leave-decided-${l.id}-${l.status}`,
          type: 'leave',
          title: `Your ${kindOf(l.leave_type || l.type) === 'leave' ? 'leave' : `${kindOf(l.leave_type || l.type)} request`} was ${String(l.status).toLowerCase()}`,
          text: `${l.leave_type || l.type || 'Leave'} from ${from}`,
          date: dateOnly(l.updated_at || l.created_at) || from,
          target: 'Leave Requests',
          tone: l.status === 'Approved' ? 'success' : 'danger',
        });
      });

      // Payroll-module payslips raise their own stored alert (section 7): skip the older payslip items then
      const storedPayslipAlerts = await qSafe("SELECT id FROM notifications WHERE recipient_id = ? AND type = 'PAYSLIP' LIMIT 1", [req.userId]);
      const slips = storedPayslipAlerts.length ? [] : await qSafe('SELECT id, month, status FROM payslips WHERE employee_id = ? ORDER BY id DESC LIMIT 2', [req.userId]);
      slips.forEach((p) => {
        items.push({
          id: `payslip-${p.id}`,
          type: 'payslip',
          title: `Payslip ready${p.month ? ` for ${p.month}` : ''}`,
          text: p.status ? `Status: ${p.status}` : 'Open Payslips to view or download it.',
          date: '',
          target: scope ? 'Payroll & Slips' : 'Payslips',
          tone: 'info',
        });
      });

      // 6) Wishes the user received for this month's birthday / work anniversary
      const yearNow = Number(istToday().slice(0, 4));
      const received = await qSafe(`
        SELECT occasion, COUNT(*) AS n, MAX(id) AS last_id FROM celebration_wishes
        WHERE to_user_id = ? AND occasion_year = ? GROUP BY occasion`, [req.userId, yearNow]);
      received.forEach((r) => {
        const n = Number(r.n || 0);
        if (!n) return;
        items.unshift({
          id: `wishes-${r.occasion}-${yearNow}-${r.last_id}`, // new id when a new wish arrives
          type: 'celebration',
          title: `${n} ${n === 1 ? 'colleague' : 'colleagues'} sent you ${r.occasion === 'birthday' ? 'birthday' : 'work anniversary'} wishes`,
          text: 'Open Celebrations on your dashboard to read them.',
          date: '',
          target: 'Dashboard',
          tone: 'success',
        });
      });

      // 7) Stored alerts: ad-hoc visits, flagged visits, reviews, site entry/exit (fieldRoutes.js)
      const FIELD_TONE = { PAYSLIP: 'success', VISIT_FLAGGED: 'danger', ADHOC_VISIT: 'info', ADHOC_REVIEWED: 'success', SITE_ENTRY: 'info', SITE_EXIT: 'info' };
      const stored = await qSafe(`SELECT * FROM notifications WHERE recipient_id = ? ORDER BY id DESC LIMIT 15`, [req.userId]);
      stored.reverse().forEach((n) => {
        items.unshift({
          id: `n-${n.id}`,
          type: 'field',
          title: n.title,
          text: n.body || '',
          date: dateOnly(n.created_at),
          target: n.type === 'PAYSLIP' ? 'Payslips' : n.type === 'ADHOC_REVIEWED' ? 'Attendance' : 'Field Attendance',
          tone: n.type === 'ADHOC_REVIEWED' && /flagged/i.test(n.title) ? 'warning' : (FIELD_TONE[n.type] || 'info'),
        });
      });

      res.json({ items: items.slice(0, 30), generatedAt: new Date().toISOString() });
    } catch (err) {
      console.error('Notifications error:', err);
      res.status(500).json({ error: 'Notifications could not be loaded.' });
    }
  });

  // =====================================================================
  // Celebration wishes
  //   GET  /celebrations/wishes?userId=&occasion=birthday|anniversary   wishes for this year's occasion
  //   POST /celebrations/wishes { userId, occasion, message }             send (or update) your wish
  // One wish per sender, per person, per occasion, per year, sent on the day itself. Colleagues in the same company
  // can wish each other; group leadership (MD / group access) can wish anyone.
  // The table is created automatically the first time the server starts.
  // =====================================================================
  const OCCASIONS = ['birthday', 'anniversary'];
  const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const parseAnyDate = (value) => {
    const str = String(value || '').trim();
    let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return { y: +m[1], m: +m[2], d: +m[3] };
    m = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    return m ? { y: +m[3], m: +m[2], d: +m[1] } : null;
  };
  let wishesReady = false;
  db.query(`CREATE TABLE IF NOT EXISTS celebration_wishes (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      to_user_id INT NOT NULL,
      from_user_id INT NOT NULL,
      occasion VARCHAR(20) NOT NULL,
      occasion_year INT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_wish (to_user_id, from_user_id, occasion, occasion_year)
    )`, (err) => {
    if (err) console.error('Could not create celebration_wishes table:', err.message);
    else wishesReady = true;
  });

  const sameCompanyOrGroup = (me, target) => isGroupMD(me)
    || (target.company_id && Number(target.company_id) === Number(me.base_company_id ?? me.company_id));

  // Loads the person being celebrated and checks the viewer may see/wish them
  const loadCelebrant = async (req, res) => {
    const userId = Number(req.query.userId || req.body?.userId);
    const occasion = String(req.query.occasion || req.body?.occasion || '').toLowerCase();
    if (!userId || !OCCASIONS.includes(occasion)) { res.status(400).json({ error: 'Choose a person and an occasion (birthday or anniversary).' }); return null; }
    const rows = await q('SELECT id, name, company_id, dob, joining_date FROM users WHERE id = ?', [userId]);
    const target = rows[0];
    if (!target) { res.status(404).json({ error: 'Employee not found.' }); return null; }
    if (Number(target.id) !== Number(req.userId) && !sameCompanyOrGroup(req.dbUser || {}, target)) {
      res.status(403).json({ error: 'You can send wishes to colleagues in your own company.' }); return null;
    }
    const today = istToday();
    const [year, month, day] = today.split('-').map(Number);
    const date = parseAnyDate(occasion === 'birthday' ? target.dob : target.joining_date);
    // Wishes can be sent only on the day itself (India time)
    const isToday = !!date && date.m === month && date.d === day && (occasion === 'birthday' || date.y < year);
    return { target, occasion, year, isToday };
  };

  router.get('/celebrations/wishes', authenticate, async (req, res) => {
    try {
      const ctx = await loadCelebrant(req, res);
      if (!ctx) return;
      if (!wishesReady) return res.json({ wishes: [], mine: null });
      const rows = await q(`
        SELECT w.id, w.from_user_id, w.message, w.created_at, u.name AS from_name, u.role AS from_role,
               COALESCE(c.name, '') AS from_company
        FROM celebration_wishes w
        LEFT JOIN users u ON u.id = w.from_user_id
        LEFT JOIN companies c ON c.id = u.company_id
        WHERE w.to_user_id = ? AND w.occasion = ? AND w.occasion_year = ?
        ORDER BY w.id DESC`, [ctx.target.id, ctx.occasion, ctx.year]);
      const wishes = rows.map((w) => ({
        id: w.id,
        fromName: w.from_name || 'A colleague',
        fromRole: w.from_role || '',
        fromCompany: w.from_company,
        message: w.message,
        createdAt: w.created_at,
        isMine: Number(w.from_user_id) === Number(req.userId),
      }));
      res.json({ wishes, mine: wishes.find((w) => w.isMine) || null });
    } catch (err) {
      console.error('Wishes load error:', err);
      res.status(500).json({ error: 'Wishes could not be loaded.' });
    }
  });

  router.post('/celebrations/wishes', authenticate, async (req, res) => {
    try {
      const ctx = await loadCelebrant(req, res);
      if (!ctx) return;
      if (Number(ctx.target.id) === Number(req.userId)) return res.status(400).json({ error: 'You cannot send wishes to yourself.' });
      if (!ctx.isToday) return res.status(400).json({ error: 'You can send wishes on their special day!' });
      const message = String(req.body?.message || '').trim().slice(0, 600);
      if (message.length < 2) return res.status(400).json({ error: 'Please write a short message.' });
      if (!wishesReady) return res.status(503).json({ error: 'Wishes are not available yet. Restart the backend and try again.' });
      const existing = await q('SELECT id FROM celebration_wishes WHERE to_user_id = ? AND from_user_id = ? AND occasion = ? AND occasion_year = ?',
        [ctx.target.id, req.userId, ctx.occasion, ctx.year]);
      if (existing.length) {
        await q('UPDATE celebration_wishes SET message = ? WHERE id = ?', [message, existing[0].id]);
        return res.json({ message: 'Your wish was updated.', id: existing[0].id, updated: true });
      }
      const result = await q('INSERT INTO celebration_wishes (to_user_id, from_user_id, occasion, occasion_year, message) VALUES (?, ?, ?, ?, ?)',
        [ctx.target.id, req.userId, ctx.occasion, ctx.year, message]);
      res.status(201).json({ message: 'Your wish was sent.', id: result?.insertId });
    } catch (err) {
      console.error('Wish send error:', err);
      res.status(500).json({ error: 'Your wish could not be sent.' });
    }
  });

  return router;
};
