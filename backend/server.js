const express = require('express');
// Restart trigger
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

app.get('/', (req, res) => {
    res.send('API is running...');
});

// Mount /uploads static handler only when running in local-disk mode.
// In S3 mode, file URLs are absolute and Express has nothing to serve.
require('./utils/storage').mountStatic(app);

// Eagerly load the Redis cache adapter so its connection status is
// logged at startup. Routes import it directly; this is just to make
// the "📦 Redis cache enabled" or fallback message appear up front.
require('./utils/cache');

// Test DB Connection
const db = require('./config/db');
db.query('SELECT 1')
    .then(() => console.log('✅ DB Connected Successfully'))
    .catch(err => {
        console.error('❌ DB Connection Failed!');
        console.error('Error Trace:', err.message);
        console.log('TIP: Ensure MySQL service is running and credentials in .env are correct.');
    });

// Warm up the background-removal model so the first upload isn't slow.
require('./utils/imageProcessor').warmUp().catch(() => {});

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/tenants', require('./routes/tenantRoutes'));
app.use('/api/billing', require('./routes/billingRoutes'));
app.use('/api/audit', require('./routes/auditRoutes'));
app.use('/api/events', require('./routes/eventRoutes'));
app.use('/api/speakers', require('./routes/speakerRoutes'));
app.use('/api/partners', require('./routes/partnerRoutes'));
app.use('/api/partner-categories', require('./routes/partnerCategoryRoutes'));
app.use('/api/awards', require('./routes/awardRoutes'));
app.use('/api/award-categories', require('./routes/awardCategoryRoutes'));
app.use('/api/chat', require('./routes/chatRoutes'));
app.use('/api/agendas', require('./routes/agendaRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/attendees', require('./routes/attendeeRoutes'));
app.use('/api/openai', require('./routes/openaiRoutes'));
app.use('/api/travel', require('./routes/travelRoutes'));
app.use('/api/settings', require('./routes/settingsRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/forms', require('./routes/formRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/smtp', require('./routes/smtpRoutes'));
app.use('/api/platform', require('./routes/platformRoutes'));
app.use('/api/announcements', require('./routes/announcementRoutes'));
app.use('/api/certificate-templates', require('./routes/certificateRoutes'));
app.use('/api/recycle-bin', require('./routes/recycleBinRoutes'));
app.use('/api/public', require('./routes/publicRoutes'));


const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown. On SIGTERM/SIGINT we stop accepting new connections,
// let in-flight requests finish, close the DB pool, then exit. Without
// this, deploys (k8s rolling updates, PM2 reloads, Docker stop) drop
// in-flight requests and can leak DB connections.
let shuttingDown = false;
const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — draining…`);
    server.close((err) => {
        if (err) console.error('HTTP server close error:', err.message);
        const end = db.end ? db.end() : Promise.resolve();
        Promise.resolve(end)
            .catch((e) => console.error('DB pool close error:', e?.message))
            .finally(() => process.exit(0));
    });
    // Hard deadline so a hung request doesn't keep the process alive forever.
    setTimeout(() => {
        console.error('Shutdown deadline exceeded — forcing exit.');
        process.exit(1);
    }, 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

