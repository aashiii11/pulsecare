const express = require('express');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// Every route below this line requires: logged in AND role = admin
router.use(requireLogin, requireRole('admin'));

// ADD A DOCTOR — only admin can do this
router.post('/add-doctor', async (req, res) => {
  try {
    const { name, email, password, specialization } = req.body;

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const doctor = await User.create({
      name,
      email,
      password: hashedPassword,
      role: 'doctor',
      specialization,
    });

    res.status(201).json({ message: 'Doctor account created', doctorId: doctor._id });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// ADD A PATIENT — admin can also directly create a patient account if needed
router.post('/add-patient', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const patient = await User.create({ name, email, password: hashedPassword, role: 'patient' });

    res.status(201).json({ message: 'Patient account created', patientId: patient._id });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// VIEW ALL USERS (patients + doctors) — useful for admin dashboard
router.get('/users', async (req, res) => {
  try {
    // exclude password field from the result for safety
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// REMOVE A USER (doctor or patient) by their ID
router.delete('/users/:id', async (req, res) => {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'User not found' });

    res.json({ message: 'User removed successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// EDIT / UPDATE a user's credentials (name, email, password, specialization)
router.put('/users/:id', async (req, res) => {
  try {
    const { name, email, password, specialization } = req.body;

    const updates = { name, email };
    if (specialization !== undefined) updates.specialization = specialization;
    if (password) updates.password = await bcrypt.hash(password, 10); // only re-hash if a new password was given

    const updated = await User.findByIdAndUpdate(req.params.id, updates, { new: true }).select('-password');
    if (!updated) return res.status(404).json({ message: 'User not found' });

    res.json({ message: 'User updated successfully', user: updated });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// ─────────────────────────────────────────────
// ADMIN: dashboard analytics (single merged route —
// the old file had this path defined twice, so the
// second definition with thisWeek/thisYear/doctorStats
// was dead code and never actually ran)
// ─────────────────────────────────────────────
router.get('/analytics', async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const totalPatients = await User.countDocuments({ role: 'patient' });
    const totalDoctors = await User.countDocuments({ role: 'doctor' });

    const todayAppointments = await Appointment.countDocuments({ createdAt: { $gte: startOfToday } });
    const todayCompleted = await Appointment.countDocuments({ createdAt: { $gte: startOfToday }, status: 'completed' });
    const todayWaiting = await Appointment.countDocuments({ createdAt: { $gte: startOfToday }, status: 'waiting' });
    const todayInProgress = await Appointment.countDocuments({ createdAt: { $gte: startOfToday }, status: 'in-progress' });

    const weekAppointments = await Appointment.countDocuments({ createdAt: { $gte: startOfWeek } });
    const yearAppointments = await Appointment.countDocuments({ createdAt: { $gte: startOfYear } });

    // Per-doctor breakdown — how many patients each doctor has seen today / this week / this year
    const doctors = await User.find({ role: 'doctor' }).select('name specialization isQueuePaused');

    const doctorStats = await Promise.all(doctors.map(async (doc) => {
      const [today, thisWeek, thisYear, totalAllTime] = await Promise.all([
        Appointment.countDocuments({ doctor: doc._id, createdAt: { $gte: startOfToday } }),
        Appointment.countDocuments({ doctor: doc._id, createdAt: { $gte: startOfWeek } }),
        Appointment.countDocuments({ doctor: doc._id, createdAt: { $gte: startOfYear } }),
        Appointment.countDocuments({ doctor: doc._id }),
      ]);
      return {
        _id: doc._id,
        name: doc.name,
        specialization: doc.specialization,
        isQueuePaused: doc.isQueuePaused,
        today,
        thisWeek,
        thisYear,
        totalAllTime,
      };
    }));

    res.json({
      totalPatients,
      totalDoctors,
      today: {
        totalAppointments: todayAppointments,
        completed: todayCompleted,
        waiting: todayWaiting,
        inProgress: todayInProgress,
      },
      thisWeek: { totalAppointments: weekAppointments },
      thisYear: { totalAppointments: yearAppointments },
      doctorStats,
    });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// ─────────────────────────────────────────────
// ADMIN: patient trend chart data (weekly / monthly / yearly)
// Powers the "Patient Trends" chart on the dashboard.
//
// GET /admin/analytics/patient-trends?range=weekly|monthly|yearly
//
//   weekly  -> last 7 days,   one bucket per day   (labels: "Mon 15 Sep")
//   monthly -> last 12 months, one bucket per month (labels: "Sep 2026")
//   yearly  -> last 5 years,   one bucket per year  (labels: "2026")
//
// Counts are based on when the patient account was created (User.createdAt),
// i.e. new patient registrations per bucket.
// ─────────────────────────────────────────────
router.get('/analytics/patient-trends', async (req, res) => {
  try {
    const range = req.query.range === 'monthly' || req.query.range === 'yearly'
      ? req.query.range
      : 'weekly';

    const now = new Date();
    let since, dateFormat, bucketCount;

    if (range === 'weekly') {
      bucketCount = 7;
      since = new Date(now);
      since.setDate(since.getDate() - (bucketCount - 1));
      since.setHours(0, 0, 0, 0);
      dateFormat = '%Y-%m-%d';
    } else if (range === 'monthly') {
      bucketCount = 12;
      since = new Date(now.getFullYear(), now.getMonth() - (bucketCount - 1), 1);
      dateFormat = '%Y-%m';
    } else {
      bucketCount = 5;
      since = new Date(now.getFullYear() - (bucketCount - 1), 0, 1);
      dateFormat = '%Y';
    }

    const results = await User.aggregate([
      { $match: { role: 'patient', createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
    ]);

    const countMap = {};
    results.forEach(r => { countMap[r._id] = r.count; });

    const labels = [];
    const counts = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    if (range === 'weekly') {
      for (let i = 0; i < bucketCount; i++) {
        const d = new Date(since);
        d.setDate(d.getDate() + i);
        const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
        labels.push(`${dayNames[d.getDay()]} ${d.getDate()}`);
        counts.push(countMap[key] || 0);
      }
    } else if (range === 'monthly') {
      for (let i = 0; i < bucketCount; i++) {
        const d = new Date(since.getFullYear(), since.getMonth() + i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        labels.push(`${monthNames[d.getMonth()]} ${d.getFullYear()}`);
        counts.push(countMap[key] || 0);
      }
    } else {
      for (let i = 0; i < bucketCount; i++) {
        const year = since.getFullYear() + i;
        labels.push(String(year));
        counts.push(countMap[String(year)] || 0);
      }
    }

    res.json({ labels, counts });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// Add these two routes to your existing routes/admin.js, alongside
// '/analytics' and '/analytics/patient-trends'. They use the SAME
// requireLogin / requireRole('admin') middleware your other /admin
// routes already use — adjust the import name if yours differs.
//
// Assumes:
//   const Appointment = require('../models/Appointment');
//   const User = require('../models/User');
// are already imported at the top of admin.js (same as queue.js).
//
// Aggregates prescription.fee across ALL doctors (no doctor filter),
// and also returns a breakdown so the admin can see who billed what.

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay()); // Sunday as start of week
  return x;
}
function startOfMonth(d) {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}
function startOfYear(d) {
  const x = startOfDay(d);
  x.setMonth(0, 1);
  return x;
}

// GET /admin/analytics/clinic-money-stats
router.get('/analytics/clinic-money-stats', requireLogin, requireRole('admin'), async (req, res) => {
  try {
    const now = new Date();
    const matchAll = { 'prescription.fee': { $gt: 0 } };

    async function sumSince(sinceDate) {
      const result = await Appointment.aggregate([
        { $match: { ...matchAll, createdAt: { $gte: sinceDate } } },
        { $group: { _id: null, total: { $sum: '$prescription.fee' } } },
      ]);
      return result[0]?.total || 0;
    }

    const [today, thisWeek, thisMonth, thisYear, allTimeAgg, byDoctorAgg] = await Promise.all([
      sumSince(startOfDay(now)),
      sumSince(startOfWeek(now)),
      sumSince(startOfMonth(now)),
      sumSince(startOfYear(now)),
      Appointment.aggregate([
        { $match: matchAll },
        { $group: { _id: null, total: { $sum: '$prescription.fee' } } },
      ]),
      Appointment.aggregate([
        { $match: matchAll },
        {
          $group: {
            _id: '$doctor',
            total: { $sum: '$prescription.fee' },
            patientCount: { $sum: 1 },
          },
        },
      ]),
    ]);
    const totalAllTime = allTimeAgg[0]?.total || 0;

    // Attach doctor names to the breakdown
    const doctorIds = byDoctorAgg.map(d => d._id);
    const doctors = await User.find({ _id: { $in: doctorIds } }).select('name specialization');
    const doctorMap = Object.fromEntries(doctors.map(d => [d._id.toString(), d]));
    const byDoctor = byDoctorAgg.map(d => ({
      doctorId: d._id,
      name: doctorMap[d._id?.toString()]?.name || 'Unknown',
      specialization: doctorMap[d._id?.toString()]?.specialization || '',
      total: d.total,
      patientCount: d.patientCount,
    }));

    // Last 7 days, day-by-day (whole clinic)
    const sevenDaysAgo = startOfDay(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const dailyAgg = await Appointment.aggregate([
      { $match: { ...matchAll, createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          total: { $sum: '$prescription.fee' },
        },
      },
    ]);
    const dailyMap = Object.fromEntries(dailyAgg.map(d => [d._id, d.total]));
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      last7Days.push({
        label: d.toLocaleDateString('en-IN', { weekday: 'short' }),
        amount: dailyMap[key] || 0,
      });
    }

    // Last 12 months, month-by-month (whole clinic)
    const twelveMonthsAgo = startOfMonth(now);
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    const monthlyAgg = await Appointment.aggregate([
      { $match: { ...matchAll, createdAt: { $gte: twelveMonthsAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          total: { $sum: '$prescription.fee' },
        },
      },
    ]);
    const monthlyMap = Object.fromEntries(monthlyAgg.map(m => [m._id, m.total]));
    const last12Months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toISOString().slice(0, 7);
      last12Months.push({
        label: d.toLocaleDateString('en-IN', { month: 'short' }),
        amount: monthlyMap[key] || 0,
      });
    }

    res.json({ today, thisWeek, thisMonth, thisYear, totalAllTime, last7Days, last12Months, byDoctor });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load clinic money stats', error: err.message });
  }
});

// GET /admin/analytics/clinic-money-stats/day?date=YYYY-MM-DD
router.get('/analytics/clinic-money-stats/day', requireLogin, requireRole('admin'), async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ message: 'date is required (YYYY-MM-DD)' });

    const dayStart = startOfDay(new Date(date));
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const result = await Appointment.aggregate([
      {
        $match: {
          createdAt: { $gte: dayStart, $lt: dayEnd },
          'prescription.fee': { $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          amount: { $sum: '$prescription.fee' },
          patientCount: { $sum: 1 },
        },
      },
    ]);

    res.json({
      date,
      amount: result[0]?.amount || 0,
      patientCount: result[0]?.patientCount || 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load clinic day profit', error: err.message });
  }
});

module.exports = router;