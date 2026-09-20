const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  tokenNumber: { type: Number, required: true },

  reasonForVisit: { type: String, required: true },
  pastHistory: { type: String }, // optional — patient's past medical history
  currentMedications: { type: String }, // optional — medicines patient is currently taking

  status: {
    type: String,
    enum: ['waiting', 'in-progress', 'completed'],
    default: 'waiting',
  },

  prescription: {
    diagnosis: { type: String }, // what exactly is wrong with the patient
    medicines: [{
      name: String,
      morning: Boolean,
      afternoon: Boolean,
      evening: Boolean,
      foodTiming: { type: String, enum: ['before', 'after', ''], default: '' },
      durationDays: Number,
    }],
    investigations: [{
      name: String, // e.g. "MRI Pelvis", "CBC"
      note: String, // e.g. "with contrast", "kindly provide discount"
    }],
    advice: { type: String }, // free-text instructions / precautions from the doctor
  },

  followUpDate: { type: Date }, // the actual calculated date of the next follow-up

  reports: [{
    url: String, // where the uploaded file is stored
    description: String, // patient's note about the report
    uploadedAt: { type: Date, default: Date.now },
  }],

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Appointment', appointmentSchema);