const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// ─────────────────────────────────────────────
// File upload setup — for patients uploading report photos
// ─────────────────────────────────────────────
const uploadsDir = path.join(__dirname, '..', 'uploads', 'reports');
fs.mkdirSync(uploadsDir, { recursive: true }); // create the folder if it doesn't exist yet

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });

// ─────────────────────────────────────────────
// PATIENT: see list of doctors (to pick who to book with)
// ─────────────────────────────────────────────
router.get('/doctors', requireLogin, async (req, res) => {
  try {
    // include isQueuePaused so patients can see if a doctor isn't accepting new patients right now
    const doctors = await User.find({ role: 'doctor' }).select('name specialization isQueuePaused');
    res.json(doctors);
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// ─────────────────────────────────────────────
// PATIENT: book an appointment / join the queue
// ─────────────────────────────────────────────
router.post('/book', requireLogin, requireRole('patient'), async (req, res) => {
  try {
    const { doctorId, reasonForVisit, pastHistory, currentMedications } = req.body;

    const doctor = await User.findOne({ _id: doctorId, role: 'doctor' });
    if (!doctor) return res.status(404).json({ message: 'Doctor not found' });

    // Token number = how many people already joined this doctor's queue today + 1
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const countToday = await Appointment.countDocuments({
      doctor: doctorId,
      createdAt: { $gte: startOfToday },
    });

    const appointment = await Appointment.create({
      patient: req.user.userId,
      doctor: doctorId,
      tokenNumber: countToday + 1,
      reasonForVisit,
      pastHistory,
      currentMedications,
    });

    res.status(201).json({ message: 'Added to queue', tokenNumber: appointment.tokenNumber, appointmentId: appointment._id });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// ─────────────────────────────────────────────
// Anyone logged in: see a doctor's current queue status
// (used to estimate wait time — only token numbers are shared, no patient details)
// ─────────────────────────────────────────────
router.get('/doctor-status/:doctorId', requireLogin, async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todaysAppointments = await Appointment.find({
      doctor: req.params.doctorId,
      createdAt: { $gte: startOfToday },
      status: { $in: ['waiting', 'in-progress'] },
    }).select('tokenNumber status');

    const inProgress = todaysAppointments.find(a => a.status === 'in-progress');
    const waitingTokens = todaysAppointments
      .filter(a => a.status === 'waiting')
      .map(a => a.tokenNumber);

    res.json({
      currentServingToken: inProgress ? inProgress.tokenNumber : null,
      waitingTokens,
    });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// ─────────────────────────────────────────────
// PATIENT: view their own appointments (queue status)
// ─────────────────────────────────────────────
router.get('/my-appointments', requireLogin, requireRole('patient'), async (req, res) => {
  try {
    const appointments = await Appointment.find({ patient: req.user.userId })
      .populate('doctor', 'name specialization')
      .sort({ createdAt: -1 });

    const AVERAGE_MINUTES_PER_PATIENT = 15; // rough estimate — adjust as needed

    // For patients still "waiting", work out how many people are ahead of them
    const results = await Promise.all(appointments.map(async (appt) => {
      const apptObj = appt.toObject();

      if (appt.status === 'waiting') {
        const startOfDay = new Date(appt.createdAt);
        startOfDay.setHours(0, 0, 0, 0);

        const patientsAhead = await Appointment.countDocuments({
          doctor: appt.doctor._id,
          createdAt: { $gte: startOfDay },
          status: { $in: ['waiting', 'in-progress'] },
          tokenNumber: { $lt: appt.tokenNumber },
        });

        apptObj.patientsAhead = patientsAhead;
        apptObj.estimatedWaitMinutes = patientsAhead * AVERAGE_MINUTES_PER_PATIENT;
      }

      return apptObj;
    }));

    res.json(results);
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// ─────────────────────────────────────────────
// DOCTOR: view today's queue (waiting + in-progress patients)
// ─────────────────────────────────────────────
router.get('/my-queue', requireLogin, requireRole('doctor'), async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const queue = await Appointment.find({
      doctor: req.user.userId,
      createdAt: { $gte: startOfToday },
      status: { $in: ['waiting', 'in-progress'] },
    })
      .populate('patient', 'name email') // pulls in patient's name/email
      .sort({ tokenNumber: 1 });

    res.json(queue);
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// ─────────────────────────────────────────────
// DOCTOR: update an appointment's status (call next / mark in-progress / complete)
// ─────────────────────────────────────────────
router.put('/:id/status', requireLogin, requireRole('doctor'), async (req, res) => {
  try {
    const { status } = req.body; // expects: 'in-progress' or 'completed'

    if (!['waiting', 'in-progress', 'completed'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }

    const appointment = await Appointment.findOneAndUpdate(
      { _id: req.params.id, doctor: req.user.userId }, // doctor can only update their own patients
      { status },
      { new: true }
    );

    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

    res.json({ message: 'Status updated', appointment });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// ─────────────────────────────────────────────
// DOCTOR: add/update a prescription (diagnosis + medicines + investigations + advice + follow-up)
// ─────────────────────────────────────────────
router.put('/:id/prescription', requireLogin, requireRole('doctor'), async (req, res) => {
  try {
    const { diagnosis, medicines, investigations, advice, followUpDate } = req.body;

    const appointment = await Appointment.findOneAndUpdate(
      { _id: req.params.id, doctor: req.user.userId },
      {
        prescription: { diagnosis, medicines, investigations, advice },
        followUpDate: followUpDate || null,
      },
      { new: true }
    );

    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

    res.json({ message: 'Prescription saved', appointment });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// ─────────────────────────────────────────────
// PATIENT: upload report photo(s) for an appointment
// ─────────────────────────────────────────────
router.post('/:id/upload-report', requireLogin, requireRole('patient'), upload.array('reports', 5), async (req, res) => {
  try {
    const appointment = await Appointment.findOne({ _id: req.params.id, patient: req.user.userId });
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

    const description = req.body.description || '';
    const newReports = (req.files || []).map(file => ({
      url: `/uploads/reports/${file.filename}`,
      description,
    }));

    appointment.reports.push(...newReports);
    await appointment.save();

    res.status(201).json({ message: 'Report(s) uploaded', reports: appointment.reports });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// ─────────────────────────────────────────────
// DOCTOR: pause or resume their queue (stops new patients from booking)
// ─────────────────────────────────────────────
router.put('/pause-toggle', requireLogin, requireRole('doctor'), async (req, res) => {
  try {
    const doctor = await User.findById(req.user.userId);
    doctor.isQueuePaused = !doctor.isQueuePaused; // flips true/false
    await doctor.save();

    res.json({ message: 'Queue status updated', isQueuePaused: doctor.isQueuePaused });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// ─────────────────────────────────────────────
// DOCTOR: call the next waiting patient (auto picks lowest token number)
// ─────────────────────────────────────────────
router.put('/call-next', requireLogin, requireRole('doctor'), async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const next = await Appointment.findOneAndUpdate(
      {
        doctor: req.user.userId,
        createdAt: { $gte: startOfToday },
        status: 'waiting',
      },
      { status: 'in-progress' },
      { new: true, sort: { tokenNumber: 1 } } // picks the smallest token number first
    ).populate('patient', 'name email');

    if (!next) return res.status(404).json({ message: 'No patients waiting in queue' });

    res.json({ message: 'Next patient called', appointment: next });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

// ─────────────────────────────────────────────
// DOCTOR: appointment stats — today / this week / this month / this year
// ─────────────────────────────────────────────
router.get('/my-stats', requireLogin, requireRole('doctor'), async (req, res) => {
  try {
    const now = new Date();

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Sunday as start of week

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const countSince = (date) => Appointment.countDocuments({ doctor: req.user.userId, createdAt: { $gte: date } });

    const [today, thisWeek, thisMonth, thisYear, totalAllTime] = await Promise.all([
      countSince(startOfToday),
      countSince(startOfWeek),
      countSince(startOfMonth),
      countSince(startOfYear),
      Appointment.countDocuments({ doctor: req.user.userId }),
    ]);

    // Last 7 days, day-by-day (for a simple bar chart)
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(startOfToday);
      dayStart.setDate(dayStart.getDate() - i);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const count = await Appointment.countDocuments({
        doctor: req.user.userId,
        createdAt: { $gte: dayStart, $lt: dayEnd },
      });

      last7Days.push({
        label: dayStart.toLocaleDateString('en-IN', { weekday: 'short' }),
        count,
      });
    }

    res.json({ today, thisWeek, thisMonth, thisYear, totalAllTime, last7Days });
  } catch (err) {
    res.status(500).json({ message: 'Something went wrong', error: err.message });
  }
});

module.exports = router;
