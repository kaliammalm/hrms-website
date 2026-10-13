/* ==========================================================================
   Employee Management: field definitions, record mapping, validation and API calls.
   One field list drives the Add Employee form and the profile drawer (view + edit),
   so labels, validation and the API payload stay identical in both places.
   Backend: backend/routes.js  (GET/POST /employees, GET /employees/meta, PUT /employees/:id)
   ========================================================================== */
import { fieldFetch } from '../field/fieldApi';

export const empFetch = (path, opts) => fieldFetch(path, opts);

export const EMPLOYMENT_TYPES = ['Full-time', 'Probation', 'Contract', 'Part-time', 'Intern', 'Consultant'];
export const DEFAULT_DEPARTMENTS = ['Accounts & Finance', 'Customer Support', 'Design', 'HR & Admin', 'Management', 'Marketing', 'Operations',
  'Projects & Site', 'Reservations', 'Sales', 'Technology'];
const GENDERS = ['Female', 'Male', 'Other'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const ATTENDANCE_MODES = [{ value: 'OFFICE', label: 'Office (check-in at office)' }, { value: 'FIELD', label: 'Field (site visits, GPS)' }];

/* Designation doubles as the access role on the server: these words give management access */
const PRIVILEGED = ['MD', 'CEO', 'HR', 'ADMIN'];
export const isPrivilegedDesignation = (r) => PRIVILEGED.some((p) => String(r || '').toUpperCase().includes(p));

/* ------------------------------------------------------------------ validation */
const digits = (v) => String(v || '').replace(/\D/g, '');
export const VALIDATORS = {
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()) ? '' : 'Enter a valid email, e.g. name@company.com'),
  phone: (v) => (/^[6-9]\d{9}$/.test(digits(v).replace(/^(91|0)(?=\d{10}$)/, '')) ? '' : 'Enter a 10-digit mobile number'),
  pan: (v) => (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(v).trim().toUpperCase()) ? '' : 'PAN looks like ABCDE1234F'),
  ifsc: (v) => (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(v).trim().toUpperCase()) ? '' : 'IFSC looks like HDFC0001234'),
  uan: (v) => (/^\d{12}$/.test(String(v).replace(/\s+/g, '')) ? '' : 'UAN is 12 digits'),
  account: (v) => (/^\d{9,18}$/.test(String(v).replace(/\s+/g, '')) ? '' : 'Account number is 9 to 18 digits'),
  aadhaar: (v) => (/^\d{12}$/.test(String(v).replace(/\s+/g, '')) ? '' : 'Aadhaar is 12 digits'),
  empCode: (v) => (/^[A-Za-z0-9][A-Za-z0-9-_/]{1,29}$/.test(String(v).trim()) ? '' : 'Use letters, digits and - (e.g. RRD-013)'),
};

/* ------------------------------------------------------------------ fields
   key       = API column (what PUT/POST expect)
   section   = drawer tab: personal | job | statutory | bank
   add       = add-form group: basic | job | money (omitted = not on the add form)
   view/edit = shown in the drawer's view / edit mode (default both)                      */
export const FIELDS = [
  // Personal
  { key: 'first_name', label: 'First name', section: 'personal', add: 'basic', required: true, half: true, autoComplete: 'off' },
  { key: 'last_name', label: 'Last name', section: 'personal', add: 'basic', half: true },
  { key: 'email', label: 'Official email', section: 'personal', add: 'basic', type: 'email', required: true, validate: 'email', hint: 'Used to sign in to the HRMS' },
  { key: 'phone', label: 'Mobile number', section: 'personal', add: 'basic', type: 'tel', validate: 'phone', placeholder: '98765 43210' },
  { key: 'dob', label: 'Date of birth', section: 'personal', type: 'date' },
  { key: 'gender', label: 'Gender', section: 'personal', type: 'select', options: GENDERS },
  { key: 'blood_group', label: 'Blood group', section: 'personal', type: 'select', options: BLOOD_GROUPS },
  { key: 'address', label: 'Residential address', section: 'personal', type: 'textarea', wide: true },
  { key: 'emergency_contact_name', label: 'Emergency contact', section: 'personal' },
  { key: 'emergency_contact_phone', label: 'Emergency contact phone', section: 'personal', type: 'tel', validate: 'phone' },
  // Job
  { key: 'role', label: 'Designation', section: 'job', add: 'job', type: 'combo', list: 'designations', required: true, placeholder: 'e.g. Sales Executive' },
  { key: 'department', label: 'Department', section: 'job', add: 'job', type: 'combo', list: 'departments', required: true, placeholder: 'e.g. Sales' },
  { key: 'employment_type', label: 'Employment type', section: 'job', add: 'job', type: 'select', options: EMPLOYMENT_TYPES, required: true },
  { key: 'joining_date', label: 'Date of joining', section: 'job', add: 'job', type: 'date', required: true },
  { key: 'reporting_manager_id', label: 'Reporting manager', section: 'job', add: 'job', type: 'manager', wide: true },
  { key: 'attendance_mode', label: 'Attendance', section: 'job', add: 'job', type: 'select', options: ATTENDANCE_MODES },
  { key: 'exit_date', label: 'Last working day', section: 'job', type: 'date', hint: 'Set only when the employee is leaving' },
  // Statutory
  { key: 'pan_number', label: 'PAN', section: 'statutory', add: 'money', validate: 'pan', upper: true, placeholder: 'ABCDE1234F' },
  { key: 'uan', label: 'UAN (PF)', section: 'statutory', add: 'money', validate: 'uan', placeholder: '12 digits' },
  { key: 'pf_number', label: 'PF number', section: 'statutory', add: 'money', upper: true, placeholder: 'TN/MAS/0012345/000/0000123' },
  { key: 'esi_number', label: 'ESI number', section: 'statutory', add: 'money', placeholder: '10 digits' },
  { key: 'aadhar_number', label: 'Aadhaar', section: 'statutory', validate: 'aadhaar', sensitive: true },
  // Bank
  { key: 'account_holder_name', label: 'Account holder name', section: 'bank' },
  { key: 'account_number', label: 'Account number', section: 'bank', add: 'money', validate: 'account', sensitive: true, inputMode: 'numeric' },
  { key: 'ifsc_code', label: 'IFSC', section: 'bank', add: 'money', validate: 'ifsc', upper: true, placeholder: 'HDFC0001234' },
  { key: 'bank_name', label: 'Bank name', section: 'bank', add: 'money', hint: 'Filled in from the IFSC when found' },
  { key: 'bank_branch', label: 'Branch', section: 'bank' },
];
export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

export const SECTIONS = [
  { id: 'personal', label: 'Personal info' },
  { id: 'job', label: 'Job details' },
  { id: 'statutory', label: 'Statutory info' },
  { id: 'bank', label: 'Bank details' },
];

/* ------------------------------------------------------------------ records */
const str = (v) => (v === null || v === undefined ? '' : String(v));
export const toInputDate = (v) => {
  const s = str(v);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : '';
};
export const formatDate = (v) => {
  const d = toInputDate(v);
  if (!d) return '';
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
/** "Gowtham Sethupathi A" → first "Gowtham Sethupathi", last "A" (users store one name column) */
export const splitName = (name) => {
  const parts = str(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] || '', last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
};

const blankish = (v) => !v || ['general', 'employee'].includes(String(v).trim().toLowerCase());

/** One shape for every screen, whatever the API row looked like */
export function normalizeEmployee(e) {
  const name = str(e.name).trim() || 'Unnamed employee';
  const exit = toInputDate(e.exit_date || e.exitDate);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const status = e.employmentStatus || (exit ? (exit <= today ? 'Exited' : 'Exiting') : 'Active');
  return {
    raw: e,
    id: e.id,
    name,
    code: str(e.emp_code || e.empCode),
    email: str(e.email),
    phone: str(e.phone),
    designation: blankish(e.role) ? str(e.designation) : str(e.role),
    department: blankish(e.department) ? '' : str(e.department),
    companyId: e.company_id ?? e.companyId ?? null,
    companyName: str(e.company_name || e.companyName),
    joiningDate: toInputDate(e.joining_date || e.joiningDate),
    employmentType: str(e.employment_type || e.employmentType),
    managerId: e.reporting_manager_id ?? e.reportingManagerId ?? null,
    managerName: str(e.reportingManager || e.reporting_manager_name || e.reporting_manager),
    attendanceMode: str(e.attendance_mode || e.attendanceMode || 'OFFICE').toUpperCase(),
    status,
    photo: e.profile_image || e.avatar || e.photo || '',
  };
}

/** Form values (API column → string) for an employee record */
export function toForm(e) {
  const r = e.raw || e;
  const { first, last } = splitName(r.name);
  return {
    first_name: first,
    last_name: last,
    email: str(r.email),
    phone: str(r.phone),
    dob: toInputDate(r.dob || r.date_of_birth),
    gender: str(r.gender),
    blood_group: str(r.blood_group || r.bloodGroup),
    address: str(r.address),
    emergency_contact_name: str(r.emergency_contact_name || r.emergencyContactName),
    emergency_contact_phone: str(r.emergency_contact_phone || r.emergencyContactPhone),
    role: blankish(r.role) ? '' : str(r.role),
    department: blankish(r.department) ? '' : str(r.department),
    employment_type: str(r.employment_type || r.employmentType),
    joining_date: toInputDate(r.joining_date || r.joiningDate),
    reporting_manager_id: str(r.reporting_manager_id ?? r.reportingManagerId ?? ''),
    attendance_mode: str(r.attendance_mode || r.attendanceMode || 'OFFICE').toUpperCase(),
    exit_date: toInputDate(r.exit_date || r.exitDate),
    pan_number: str(r.pan_number || r.panNumber),
    uan: str(r.uan),
    pf_number: str(r.pf_number || r.pfNumber),
    esi_number: str(r.esi_number || r.esiNumber),
    aadhar_number: str(r.aadhar_number || r.aadharNumber),
    account_holder_name: str(r.account_holder_name || r.accountHolderName),
    account_number: str(r.account_number || r.accountNumber),
    ifsc_code: str(r.ifsc_code || r.ifscCode),
    bank_name: str(r.bank_name || r.bankName),
    bank_branch: str(r.bank_branch || r.bankBranch),
  };
}

/** Field-level errors for the given keys: { key: message } */
export function validate(values, keys) {
  const errors = {};
  keys.forEach((k) => {
    const f = FIELD_BY_KEY[k];
    if (!f) return;
    const v = str(values[k]).trim();
    if (!v) { if (f.required) errors[k] = `${f.label} is required`; return; }
    if (f.validate) { const msg = VALIDATORS[f.validate](v); if (msg) errors[k] = msg; }
  });
  return errors;
}

/** Cleans values for the API: trims, uppercases codes, joins the name */
export function toPayload(values, keys) {
  const out = {};
  keys.forEach((k) => {
    if (k === 'first_name' || k === 'last_name') return;
    const f = FIELD_BY_KEY[k];
    let v = str(values[k]).trim();
    if (f?.upper) v = v.toUpperCase();
    if (['uan', 'account_number', 'aadhar_number'].includes(k)) v = v.replace(/\s+/g, '');
    if (k === 'reporting_manager_id') { out[k] = v ? Number(v) : null; return; }
    out[k] = v;
  });
  if (keys.includes('first_name') || keys.includes('last_name')) {
    out.name = `${str(values.first_name).trim()} ${str(values.last_name).trim()}`.trim();
  }
  return out;
}

/** Keys whose value differs from the baseline */
export const changedKeys = (values, baseline) => Object.keys(values).filter((k) => str(values[k]).trim() !== str(baseline[k]).trim());

/* Key fields that make a profile complete (payroll and bank transfer need them) */
const COMPLETENESS = [
  ['phone', 'Mobile number'], ['dob', 'Date of birth'], ['role', 'Designation'], ['department', 'Department'], ['joining_date', 'Joining date'],
  ['employment_type', 'Employment type'], ['reporting_manager_id', 'Reporting manager'], ['pan_number', 'PAN'],
  ['account_number', 'Account number'], ['ifsc_code', 'IFSC'], ['bank_name', 'Bank name'],
];
export function completeness(form, email) {
  const missing = COMPLETENESS.filter(([k]) => !str(form[k]).trim()).map(([, l]) => l);
  if (!email || /@pending\.local$/i.test(email)) missing.unshift('Sign-in email');
  const total = COMPLETENESS.length + 1;
  return { missing, percent: Math.round(((total - missing.length) / total) * 100) };
}

export const maskTail = (v, keep = 4) => {
  const s = str(v).replace(/\s+/g, '');
  return s.length > keep ? `${'•'.repeat(Math.min(8, s.length - keep))}${s.slice(-keep)}` : s;
};

/** Bank name + branch from an IFSC (public Razorpay IFSC directory). Returns null when unknown/offline. */
const ifscCache = {};
export async function lookupIfsc(code) {
  const c = str(code).trim().toUpperCase();
  if (VALIDATORS.ifsc(c)) return null;
  if (ifscCache[c] !== undefined) return ifscCache[c];
  try {
    const res = await fetch(`https://ifsc.razorpay.com/${c}`);
    ifscCache[c] = res.ok ? await res.json().then((d) => ({ bank: d.BANK || '', branch: [d.BRANCH, d.CITY].filter(Boolean).join(', ') })) : null;
  } catch (e) { ifscCache[c] = null; }
  return ifscCache[c];
}

export const STATUS_TONE = { Active: 'success', Exiting: 'warning', Exited: 'neutral' };
