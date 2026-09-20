const mongoose = require('mongoose');
 
// This function connects your app to MongoDB using the link
// saved in your .env file (MONGO_URI).
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected successfully');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1); // stop the app if the database doesn't connect
  }
}
 
module.exports = connectDB;
 