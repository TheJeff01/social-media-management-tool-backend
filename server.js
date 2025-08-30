const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

// Import database connection
const connectDB = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3001;

// Connect to MongoDB
connectDB();

// Import routes
const authRoutes = require('./routes/auth');
const twitterRoutes = require('./routes/twitter');
const linkedinRoutes = require('./routes/linkedin');
const facebookRoutes = require('./routes/facebook');
const instagramRoutes = require('./routes/instagram');
const postingRoutes = require('./routes/posting');

// Import middleware
const corsMiddleware = require('./middleware/cors');

// Middleware
app.use(corsMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (callback pages)
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/auth', authRoutes);
app.use('/auth/twitter', twitterRoutes);
app.use('/auth/linkedin', linkedinRoutes);
app.use('/auth/facebook', facebookRoutes);
app.use('/auth/instagram', instagramRoutes);
app.use('/api/posting', postingRoutes);

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Social Media OAuth Backend is running!', 
    timestamp: new Date().toISOString(),
    endpoints: {
      twitter: '/auth/twitter',
      linkedin: '/auth/linkedin',
      instagram: '/auth/instagram',
      facebook: '/auth/facebook',
      posting: '/api/posting',
      health: '/'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  // Handle MongoDB errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({ 
      error: 'Validation Error',
      message: Object.values(err.errors).map(e => e.message).join(', ')
    });
  }
  
  if (err.code === 11000) {
    return res.status(400).json({ 
      error: 'Duplicate Error',
      message: 'This record already exists'
    });
  }
  
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ 
      error: 'Invalid Token',
      message: 'Invalid or expired token'
    });
  }
  
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ 
      error: 'Token Expired',
      message: 'Token has expired'
    });
  }
  
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📱 Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log(`🐦 Twitter OAuth: http://localhost:${PORT}/auth/twitter`);
  console.log(`💼 LinkedIn OAuth: http://localhost:${PORT}/auth/linkedin`);
  console.log(`📘 Facebook OAuth: http://localhost:${PORT}/auth/facebook`);
});