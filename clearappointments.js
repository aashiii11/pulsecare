// ONE-TIME SCRIPT — deletes all existing appointments (old test data).
// Run this once, then you can delete this file.

require('dotenv').config();
const mongoose = require('mongoose');
const Appointment = require('./models/Appointment');

async function clearAppointments() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to database...');

    const result = await Appointment.deleteMany({});
    console.log(`✅ Deleted ${result.deletedCount} old appointment(s).`);

    process.exit(0);
  } catch (err) {
    console.error('Something went wrong:', err.message);
    process.exit(1);
  }
}

clearAppointments();