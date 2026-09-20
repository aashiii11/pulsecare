require('dotenv').config();
const connectDB = require('./config/db');
connectDB();

const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();      
app.use(express.static(path.join(__dirname, 'Frontend')));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'Frontend', 'index.html')); });    // <-- app pehle banao

app.use(cors());                // <-- fir cors use karo
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // uploaded reports dikhane ke liye

const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

const adminRoutes = require('./routes/admin');
app.use('/api/admin', adminRoutes);

const queueRoutes = require('./routes/queue');
app.use('/api/queue', queueRoutes);

if (process.env.VERCEL !== '1') {
  app.listen(process.env.PORT || 5000, () => console.log('🚀 Server running'));
}

module.exports = app;