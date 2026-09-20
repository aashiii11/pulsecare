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

module.exports = router;