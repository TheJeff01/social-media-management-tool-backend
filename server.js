const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Import routes
const authRoutes = require('./routes/auth');
const twitterRoutes = require('./routes/twitter');
const linkedinRoutes = require('./routes/linkedin');
const facebookRoutes = require('./routes/facebook');
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
app.use('/api/posting', postingRoutes);

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Social Media OAuth Backend is running!', 
    timestamp: new Date().toISOString(),
    endpoints: {
      twitter: '/auth/twitter',
      linkedin: '/auth/linkedin',
      facebook: '/auth/facebook',
      posting: '/api/posting',
      health: '/'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
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