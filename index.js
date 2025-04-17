// *****************************************************
// <!-- Section 1 : Import Dependencies -->
// *****************************************************

const express = require('express'); // To build an application server or API
const app = express();
const handlebars = require('express-handlebars');
const Handlebars = require('handlebars');
const path = require('path');
const pgp = require('pg-promise')(); // To connect to the Postgres DB from the node server
const bodyParser = require('body-parser');
const session = require('express-session'); // To set the session object. To store or access session data, use the `req.session`, which is (generally) serialized as JSON by the store.
const bcrypt = require('bcryptjs'); //  To hash passwords
const axios = require('axios'); // To make HTTP requests from our server. We'll learn more about it in Part C.

// *****************************************************
// <!-- Section 2 : Connect to DB -->
// *****************************************************

// create `ExpressHandlebars` instance and configure the layouts and partials dir.
const hbs = handlebars.create({
  extname: 'hbs',
  layoutsDir: __dirname + '/views/layouts',
  partialsDir: __dirname + '/views/partials',
  helpers: {
    inc: (value) => parseInt(value) + 1,
    join: (array, separator) => Array.isArray(array) ? array.join(separator || ', ') : '',
    json: context => JSON.stringify(context)
  }
});
hbs.handlebars.registerHelper('defaultSets', function(count) {
  return Array.from({ length: count });
});
hbs.handlebars.registerHelper('array', (...args) => args.slice(0, -1));
hbs.handlebars.registerHelper('inc', function(value) {
  return parseInt(value) + 1;
});

// database configuration


const db = pgp(
  process.env.DATABASE_URL || {
    host: 'localhost',
    port: 5432,
    database: 'your_local_db_name',
    user: 'your_local_user',
    password: 'your_local_password'
  }
);


// test your database
db.connect()
  .then(obj => {
    console.log('Database connection successful'); // you can view this message in the docker compose logs
    obj.done(); // success, release the connection;
  })
  .catch(error => {
    console.log('ERROR:', error.message || error);
  });

// *****************************************************
// <!-- Section 3 : App Settings -->
// *****************************************************

// Register `hbs` as our view engine using its bound `engine()` function.
app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.json()); // specify the usage of JSON for parsing request body.

// initialize session variables
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
  })
);

app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

// *****************************************************
// <!-- Section 4 : API Routes -->
// *****************************************************
// Authentication Middleware.


app.get('/login', (req, res) => {
  const { message, error } = req.session;
  delete req.session.message;
  delete req.session.error;

  res.render('Pages/login', {
    ...(message && { message }),
    ...(error && { error })
  });
});
app.get('/init', async (req, res) => {
  try {
    await db.none(`
      CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        email TEXT UNIQUE,
        password TEXT NOT NULL,
        weekly_workout_count INT DEFAULT 0,
        weekly_total_weight INT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS workout_sessions (
        session_id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS workouts (
        workout_id SERIAL PRIMARY KEY,
        session_id INT REFERENCES workout_sessions(session_id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        low_rep_range INT,
        high_rep_range INT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS friends (
        friendship_id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
        friend_id INT REFERENCES users(user_id) ON DELETE CASCADE,
        status TEXT CHECK (status IN ('pending', 'accepted')) NOT NULL DEFAULT 'pending',
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, friend_id)
      );

      CREATE TABLE IF NOT EXISTS friend_requests (
        request_id SERIAL PRIMARY KEY,
        sender_id INT REFERENCES users(user_id) ON DELETE CASCADE,
        receiver_id INT REFERENCES users(user_id) ON DELETE CASCADE,
        status TEXT CHECK (status IN ('pending', 'accepted', 'declined')) DEFAULT 'pending',
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        responded_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS completed_workouts (
        completed_id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
        session_id INT REFERENCES workout_sessions(session_id),
        exercise_name TEXT NOT NULL,
        sets INT NOT NULL,
        reps INT NOT NULL,
        weight INT NOT NULL,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS completed_sets (
        set_id SERIAL PRIMARY KEY,
        completed_workout_id INT REFERENCES completed_workouts(completed_id) ON DELETE CASCADE,
        set_number INT NOT NULL,
        reps INT NOT NULL,
        weight INT NOT NULL
      );
    `);
    res.send('✅ Database initialized!');
  } catch (err) {
    console.error('❌ Init error:', err);
    res.status(500).send('Failed to initialize DB.');
  }
});



  app.get('/register', (req, res) => {
    res.render('Pages/register')
  });

  app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    const hash = await bcrypt.hash(password, 10);
  
    try {
      const newUser = await db.one(
        `INSERT INTO users (username, password) 
         VALUES ($1, $2) 
         RETURNING user_id, username`,
        [username, hash]
      );
  
      // Auto-login: store user in session
      req.session.user_id = newUser.user_id;
      req.session.username = newUser.username;
  
      res.redirect('/home');
    } catch (err) {
      console.error('Registration failed:', err);
      res.redirect('/register');
    }
  });
  


  app.post('/login', async (req, res) => {
    const { username, password } = req.body;
  
    try {
      const user = await db.oneOrNone(
        `SELECT user_id, username, password FROM users WHERE username = $1`,
        [username]
      );
  
      if (!user) {
        req.session.message = 'User not found. <a href="/register" class="text-warning text-decoration-underline">Create one</a>';

        req.session.error = true;
        return res.redirect('/login'); // ✅ redirect, not render
      }
  
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        req.session.message = 'Incorrect password.';
        req.session.error = true;
        return res.redirect('/login'); // ✅ redirect again
      }
  
      req.session.user_id = user.user_id;
      req.session.username = user.username;
  
      req.session.save(() => res.redirect('/home'));
    } catch (err) {
      console.error('Login error:', err);
      req.session.message = 'Something went wrong. Please try again.';
      req.session.error = true;
      res.redirect('/login'); // ✅ redirect here too
    }
  });
  
  
  
  
  

  
  
  app.use((req, res, next) => {
    res.locals.user_id = req.session.user_id || null;
    res.locals.username = req.session.username || null;
    next();
  });
  
  
  const auth = (req, res, next) => {
    if (!req.session.user_id) {
      return res.redirect('/login');
    }
    next();
  };
  
  
  // Authentication Required
  app.use(auth);

  const getStartOfWeek = () => {
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday
    const diff = now.getDate() - day;
    const sunday = new Date(now.setDate(diff));
    sunday.setHours(0, 0, 0, 0);
    return sunday.toISOString(); // For SQL comparison
  };
  
  app.get('/home', async (req, res) => {
    const userId = req.session.user_id;
    const startOfWeek = getStartOfWeek();
  
    try {
      // Weekly workout stats for the user
      const userStats = await db.oneOrNone(`
        SELECT 
          COUNT(DISTINCT DATE(completed_at)) AS "daysWorkedOut",
          COALESCE(SUM(weight), 0) AS "totalWeight"
        FROM completed_workouts
        WHERE user_id = $1 AND completed_at >= $2
      `, [userId, startOfWeek]);
  
      // Find the most improved exercise (based on reps)
      const mostImproved = await db.oneOrNone(`
        SELECT exercise_name
        FROM completed_workouts
        WHERE user_id = $1 AND completed_at >= $2
        GROUP BY exercise_name
        ORDER BY SUM(reps) DESC
        LIMIT 1
      `, [userId, startOfWeek]);
  
      // Leaderboard (user + friends)
      const leaderboard = await db.any(`
        SELECT u.username AS name,
               COUNT(DISTINCT DATE(cw.completed_at)) AS "daysWorkedOut",
               COALESCE(SUM(cw.weight), 0) AS "totalWeight",
               u.user_id = $1 AS "isUser"
        FROM users u
        LEFT JOIN completed_workouts cw ON cw.user_id = u.user_id AND cw.completed_at >= $2
        WHERE u.user_id = $1
           OR u.user_id IN (
              SELECT friend_id FROM friends WHERE user_id = $1 AND status = 'accepted'
              UNION
              SELECT user_id FROM friends WHERE friend_id = $1 AND status = 'accepted'
           )
        GROUP BY u.user_id
        ORDER BY "totalWeight" DESC
      `, [userId, startOfWeek]);
      const lastUpdatedRow = await db.oneOrNone(`
        SELECT MAX(completed_at) AS last_updated
        FROM completed_workouts
        WHERE user_id = $1
           OR user_id IN (
             SELECT friend_id FROM friends WHERE user_id = $1 AND status = 'accepted'
             UNION
             SELECT user_id FROM friends WHERE friend_id = $1 AND status = 'accepted'
           )
        AND completed_at >= date_trunc('week', CURRENT_DATE)
      `, [userId]);
      
      const lastUpdated = lastUpdatedRow?.last_updated
        ? new Date(lastUpdatedRow.last_updated).toLocaleString('en-US', {
            dateStyle: 'long',
            timeStyle: 'short'
          })
        : 'No activity this week';
      
      // Session templates
      const sessions = await db.any(`
        SELECT s.session_id, s.name, COUNT(w.workout_id) AS exercises_count
        FROM workout_sessions s
        LEFT JOIN workouts w ON s.session_id = w.session_id
        WHERE s.user_id = $1
        GROUP BY s.session_id
        ORDER BY s.created_at DESC
      `, [userId]);
  
      res.render('Pages/home', {
        stats: {
          daysWorkedOut: userStats?.daysWorkedOut || 0,
          totalWeight: userStats?.totalWeight || 0,
          mostImproved: mostImproved?.exercise_name || 'N/A'
        },
        leaderboard,
        sessions,
        noData: !userStats?.daysWorkedOut,
        lastUpdated
      });
    } catch (err) {
      console.error('❌ Failed to load home page:', err);
      res.render('Pages/home', {
        noData: true,
        leaderboard: [],
        sessions: [],
        stats: {}
      });
    }
  });
  
  
  
  app.get('/sessions', async (req, res) => {
    const userId = req.session.user_id;
  
    try {
      const sessions = await db.any(`
        SELECT ws.session_id, ws.name, ws.created_at,
          COUNT(w.workout_id) AS exercise_count
        FROM workout_sessions ws
        LEFT JOIN workouts w ON ws.session_id = w.session_id
        WHERE ws.user_id = $1
        GROUP BY ws.session_id
        ORDER BY ws.created_at DESC
      `, [userId]);
  
      res.render('Pages/sessions', { sessions });
    } catch (err) {
      console.error('Failed to load workout sessions:', err);
      res.render('Pages/sessions', { sessions: [], message: 'Unable to load sessions' });
    }
  });
  
  app.get('/profile', async (req, res) => {
    const userId = req.session.user_id;
  
    try {
      const user = await db.one(
        `SELECT username, weekly_workout_count, weekly_total_weight
         FROM users
         WHERE user_id = $1`,
        [userId]
      );
  
      res.render('Pages/profile', { user });
    } catch (err) {
      console.error('❌ Failed to load profile:', err);
      res.redirect('/home');
    }
  });
  
  app.get('/friends', async (req, res) => {
    const userId = req.session.user_id;
  
    try {
      const friends = await db.any(`
        SELECT u.user_id, u.username
        FROM friends f
        JOIN users u ON u.user_id = f.friend_id
        WHERE f.user_id = $1 AND f.status = 'accepted'
      `, [userId]);
  
      const requests = await db.any(`
        SELECT fr.request_id, u.user_id, u.username
        FROM friend_requests fr
        JOIN users u ON fr.sender_id = u.user_id
        WHERE fr.receiver_id = $1 AND fr.status = 'pending'
      `, [userId]);
  
      res.render('Pages/friends', { friends, requests });
    } catch (err) {
      console.error('Error loading friends:', err);
      res.render('Pages/friends', { friends: [], requests: [], error: 'Could not load friends.' });
    }
  });
  
  
  app.post('/friends/request', async (req, res) => {
    const userId = req.session.user_id;
    const { username } = req.body;
  
    try {
      const target = await db.oneOrNone(`SELECT user_id FROM users WHERE username = $1`, [username]);
  
      if (!target || target.user_id === userId) return res.redirect('/friends');
  
      // Don't duplicate requests
      await db.none(`
        INSERT INTO friend_requests (sender_id, receiver_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `, [userId, target.user_id]);
  
      res.redirect('/friends');
    } catch (err) {
      console.error('Error sending request:', err);
      res.redirect('/friends');
    }
  });
  
  app.post('/friends/accept', async (req, res) => {
    const receiverId = req.session.user_id;
    const { sender_id } = req.body;
  
    try {
      await db.none(`
        UPDATE friend_requests
        SET status = 'accepted', responded_at = NOW()
        WHERE sender_id = $1 AND receiver_id = $2
      `, [sender_id, receiverId]);
  
      // Create mutual entries
      await db.none(`
        INSERT INTO friends (user_id, friend_id, status)
        VALUES ($1, $2, 'accepted'), ($2, $1, 'accepted')
        ON CONFLICT DO NOTHING
      `, [receiverId, sender_id]);
  
      res.redirect('/friends');
    } catch (err) {
      console.error('Error accepting friend:', err);
      res.redirect('/friends');
    }
  });
  
  app.post('/friends/decline', async (req, res) => {
    const receiverId = req.session.user_id;
    const { sender_id } = req.body;
  
    try {
      await db.none(`
        UPDATE friend_requests
        SET status = 'declined', responded_at = NOW()
        WHERE sender_id = $1 AND receiver_id = $2
      `, [sender_id, receiverId]);
  
      res.redirect('/friends');
    } catch (err) {
      console.error('Error declining friend:', err);
      res.redirect('/friends');
    }
  });
  
  
  app.post('/friends/remove', async (req, res) => {
    const userId = req.session.user_id;
    const { friend_id } = req.body;
  
    try {
      await db.none(`
        DELETE FROM friends
        WHERE (user_id = $1 AND friend_id = $2)
           OR (user_id = $2 AND friend_id = $1)
      `, [userId, friend_id]);
  
      res.redirect('/friends');
    } catch (err) {
      console.error('Error removing friend:', err);
      res.redirect('/friends');
    }
  });
  app.get('/sessions', async (req, res) => {
    const userId = req.session.user_id;
  
    try {
      const sessions = await db.any(`
        SELECT session_id, name, to_char(created_at, 'YYYY-MM-DD') AS created_at
        FROM workout_sessions
        WHERE user_id = $1
        ORDER BY created_at DESC
      `, [userId]);
  
      res.render('Pages/sessions', { sessions });
    } catch (err) {
      console.error('Failed to load workout sessions:', err);
      res.render('Pages/sessions', { sessions: [] });
    }
  });
  
  app.get('/history', async (req, res) => {
    const userId = req.session.user_id;
  
    try {
      const rawHistory = await db.any(`
        SELECT 
          ws.name AS session_name,
          cw.exercise_name,
          cw.completed_id,
          TO_CHAR(cw.completed_at, 'YYYY-MM-DD') AS workout_date,
          cs.set_number,
          cs.reps,
          cs.weight
        FROM completed_workouts cw
        JOIN workout_sessions ws ON ws.session_id = cw.session_id
        JOIN completed_sets cs ON cs.completed_workout_id = cw.completed_id
        WHERE cw.user_id = $1
        ORDER BY cw.completed_at DESC, cs.set_number ASC
      `, [userId]);
  
      const groupedWorkouts = {};
      const chartData = {};
  
      for (const entry of rawHistory) {
        const {
          workout_date, session_name, exercise_name,
          reps, weight, completed_id
        } = entry;
  
        if (!groupedWorkouts[workout_date]) {
          groupedWorkouts[workout_date] = {
            totalVolume: 0,
            exercises: []
          };
        }
  
        const key = `${workout_date}_${session_name}_${exercise_name}_${completed_id}`;
        let exercise = groupedWorkouts[workout_date].exercises.find(e => e.key === key);
  
        if (!exercise) {
          exercise = {
            key,
            session_name,
            exercise_name,
            reps: [],
            weights: []
          };
          groupedWorkouts[workout_date].exercises.push(exercise);
        }
  
        exercise.reps.push(reps);
        exercise.weights.push(weight);
        groupedWorkouts[workout_date].totalVolume += reps * weight;
  
        if (!chartData[session_name]) chartData[session_name] = [];
        const chartEntry = chartData[session_name].find(e => e.date === workout_date);
        if (chartEntry) {
          chartEntry.volume += reps * weight;
        } else {
          chartData[session_name].push({ date: workout_date, volume: reps * weight });
        }
      }
  
      res.render('Pages/history', {
        groupedWorkouts,
        chartDataBySession: JSON.stringify(chartData)
      });
  
    } catch (err) {
      console.error('❌ Error loading workout history:', err);
      res.render('Pages/history', {
        groupedWorkouts: null,
        chartDataBySession: '{}',
        message: 'Unable to load workout history.'
      });
    }
  });
  
  
  
  
  
  app.get('/history-demo', async (req, res) => {
    const groupedWorkouts = {
      '2025-04-14': [
        {
          session_name: 'Push Day',
          exercise_name: 'Bench Press',
          reps: [8, 6, 4],
          weights: [135, 145, 155]
        },
        {
          session_name: 'Push Day',
          exercise_name: 'Overhead Press',
          reps: [6, 6, 5],
          weights: [95, 100, 100]
        }
      ],
      '2025-04-12': [
        {
          session_name: 'Pull Day',
          exercise_name: 'Deadlift',
          reps: [5, 5, 5],
          weights: [225, 235, 245]
        },
        {
          session_name: 'Pull Day',
          exercise_name: 'Barbell Row',
          reps: [10, 8],
          weights: [135, 145]
        }
      ]
    };
  
    // 🔢 Add total volume per day
    const groupedWithTotals = {};
    for (const [date, workouts] of Object.entries(groupedWorkouts)) {
      let total = 0;
      workouts.forEach(w => {
        w.reps.forEach((rep, i) => {
          const weight = w.weights[i] || 0;
          total += rep * weight;
        });
      });
      groupedWithTotals[date] = {
        totalVolume: total,
        exercises: workouts
      };
    }
  
    const chartDataBySession = {
      "Push Day": [
        { date: "2025-04-14", volume: 1930 }
      ],
      "Pull Day": [
        { date: "2025-04-12", volume: 2770 }
      ]
    };
  
    res.render('Pages/history', {
      groupedWorkouts: groupedWithTotals,
      chartDataBySession: JSON.stringify(chartDataBySession)
    });
  });
  

  

  app.post('/sessions/:id/delete', async (req, res) => {
    const sessionId = req.params.id;
    const userId = req.session.user_id;
  
    try {
      // Make sure the session belongs to the user
      const session = await db.oneOrNone(
        `SELECT session_id FROM workout_sessions WHERE session_id = $1 AND user_id = $2`,
        [sessionId, userId]
      );
  
      if (!session) return res.redirect('/sessions');
  
      await db.none(`DELETE FROM workout_sessions WHERE session_id = $1`, [sessionId]);
  
      res.redirect('/sessions');
    } catch (err) {
      console.error('Error deleting session:', err);
      res.redirect('/sessions');
    }
  });
  
  app.get('/sessions/:id/json', async (req, res) => {
    const sessionId = req.params.id;
    try {
      const session = await db.one('SELECT * FROM workout_sessions WHERE session_id = $1', [sessionId]);
      const exercises = await db.any(`
SELECT name, low_rep_range, high_rep_range, notes
FROM workouts
WHERE session_id = $1
ORDER BY workout_id ASC

      `, [sessionId]);
  
      res.json({
        name: session.name,
        exercises
      });
    } catch (err) {
      console.error('❌ Failed to fetch session data:', err);
      res.status(500).json({ error: 'Could not load session' });
    }
  });
  app.get('/sessions/:id/edit', async (req, res) => {
    const sessionId = req.params.id;
    const userId = req.session.user_id;
  
    try {
      const session = await db.one(`
        SELECT * FROM workout_sessions 
        WHERE session_id = $1 AND user_id = $2
      `, [sessionId, userId]);
  
      const exercises = await db.any(`
        SELECT * FROM workouts 
        WHERE session_id = $1 
        ORDER BY workout_id
      `, [sessionId]);
  
      res.json({ session, exercises });
    } catch (err) {
      console.error('Error loading session for editing:', err);
      res.status(500).json({ error: 'Failed to load session' });
    }
  });
  app.post('/sessions/:id/edit', async (req, res) => {
    const sessionId = req.params.id;
    const { session_name, exercises } = req.body;
    const userId = req.session.user_id;
  
    try {
      await db.tx(async t => {
        await t.none(`
          UPDATE workout_sessions SET name = $1 WHERE session_id = $2 AND user_id = $3
        `, [session_name, sessionId, userId]);
  
        await t.none(`DELETE FROM workouts WHERE session_id = $1`, [sessionId]);
  
        const insertPromises = exercises.map(ex => {
          return t.none(`
            INSERT INTO workouts (session_id, name, weight, reps, notes)
            VALUES ($1, $2, $3, $4, $5)
          `, [sessionId, ex.name, ex.weight || 0, ex.reps || null, ex.notes || null]);
        });
  
        await Promise.all(insertPromises);
      });
  
      res.json({ success: true });
    } catch (err) {
      console.error('Error updating session:', err);
      res.status(500).json({ error: 'Failed to update session' });
    }
  });
  

  app.post('/sessions/create-with-exercises', async (req, res) => {
    const { session_name, exercises } = req.body;
    const userId = req.session.user_id;
  
    try {
      const sessionResult = await db.one(
        'INSERT INTO workout_sessions (user_id, name) VALUES ($1, $2) RETURNING session_id',
        [userId, session_name]
      );
      const sessionId = sessionResult.session_id;
  
      for (const ex of exercises) {
        const { name, low, high, notes } = ex;
        await db.none(
          `INSERT INTO workouts (session_id, name, low_rep_range, high_rep_range, notes)
           VALUES ($1, $2, $3, $4, $5)`,
          [sessionId, name, low, high, notes || '']
        );
      }
  
      res.json({ success: true }); // ✅ Send success response
    } catch (err) {
      console.error('Error creating session with exercises:', err);
      res.status(500).json({ success: false, message: 'Failed to create session' });
    }
  });
  
  
  
  
  app.post('/sessions/:id/exercises', async (req, res) => {
    const sessionId = req.params.id;
    const userId = req.session.user_id;
    const { name, weight, reps, notes } = req.body;
  
    try {
      const session = await db.oneOrNone(
        `SELECT session_id FROM workout_sessions WHERE session_id = $1 AND user_id = $2`,
        [sessionId, userId]
      );
      if (!session) return res.redirect('/sessions');
  
      await db.none(`
        INSERT INTO workouts (session_id, name, weight, reps, notes)
        VALUES ($1, $2, $3, $4, $5)
      `, [sessionId, name, weight, reps || null, notes || null]);
  
      res.redirect(`/sessions/${sessionId}`);
    } catch (err) {
      console.error('Error adding exercise:', err);
      res.redirect(`/sessions/${sessionId}`);
    }
  });

  app.post('/workouts/start/:session_id', async (req, res) => {
    const sessionId = req.params.session_id;
    const userId = req.session.user_id;
  
    try {
      const session = await db.one(
        'SELECT * FROM workout_sessions WHERE session_id = $1 AND user_id = $2',
        [sessionId, userId]
      );
  
      const exercises = await db.any(
        'SELECT * FROM workouts WHERE session_id = $1 ORDER BY workout_id ASC',
        [sessionId]
      );
  
      const pastData = await db.any(
        `SELECT exercise_name, weight, reps
         FROM completed_workouts
         WHERE session_id = $1 AND user_id = $2
         ORDER BY completed_at DESC`,
        [sessionId, userId]
      );
  
      const grouped = {};
      pastData.forEach(row => {
        if (!grouped[row.exercise_name]) grouped[row.exercise_name] = [];
        grouped[row.exercise_name].push(row);
      });
  
      const enrichedExercises = exercises.map((ex) => {
        const history = grouped[ex.name] || [];
        const lastUsedWeight = history.length ? history[0].weight : '';
  
        // Determine if all sets previously hit the max reps
        const metRepRange = history.length > 0 &&
          history.every(set => set.reps >= ex.high_rep_range);
  
        return {
          ...ex,
          recommendation: metRepRange ? 'Try increasing weight this time!' : null,
          sets: Array(3).fill().map(() => ({
            reps: '',
            weight: lastUsedWeight
          }))
        };
      });
  
      res.render('Pages/startworkout', { exercises: enrichedExercises,sessionId });
  
    } catch (err) {
      console.error('❌ Failed to load workout session:', err);
      res.status(500).send('Error loading workout session.');
    }
  });
  
  app.post('/workouts/complete', async (req, res) => {
    console.log('Received workout submission:', req.body);

    const userId = req.session.user_id;
    const { session_id, exercises } = req.body;
  
    if (!userId || !session_id || !exercises || typeof exercises !== 'object') {
      return res.status(400).send('Invalid workout submission.');
    }
  
    try {
      for (const exercise of Object.values(exercises)) {
        const { sets = [], name } = exercise;
  
        if (!name || !Array.isArray(sets)) continue;
  
        let totalReps = 0;
        let totalWeight = 0;
  
        const parsedSets = sets.map((set, i) => {
          const reps = parseInt(set.reps);
          const weight = parseInt(set.weight);
          totalReps += reps;
          totalWeight += reps * weight;
          return { reps, weight, set_number: i + 1 };
        });
  
        const { completed_id } = await db.one(
          `INSERT INTO completed_workouts
            (user_id, session_id, exercise_name, sets, reps, weight, completed_at)
           VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE)
           RETURNING completed_id`,
          [userId, session_id, name, parsedSets.length, totalReps, totalWeight]
        );
        
  
        for (const set of parsedSets) {
          await db.none(
            `INSERT INTO completed_sets (completed_workout_id, set_number, reps, weight)
             VALUES ($1, $2, $3, $4)`,
            [completed_id, set.set_number, set.reps, set.weight]
          );
        }
      }
  
      res.redirect('/history');
    } catch (err) {
      console.error('❌ Error saving completed workout:', err);
      res.status(500).send('Failed to complete workout');
    }
  });
  
  
  
app.get('/logout', (req, res) => {
    req.session.destroy(function(err) {
      res.render('Pages/logout');
    });
  });
  

// *****************************************************
// <!-- Section 5 : Start Server-->
// *****************************************************
// starting the server and keeping the connection open to listen for more requests
app.listen(3000);
console.log('Server is listening on port 3000');
