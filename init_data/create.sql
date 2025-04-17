-- Users Table (if not already present)
CREATE TABLE users (
  user_id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password TEXT NOT NULL,

  -- Weekly stats
  weekly_workout_count INT DEFAULT 0,
  weekly_total_weight INT DEFAULT 0
);


-- Workout Sessions
CREATE TABLE workout_sessions (
  session_id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Exercises inside a workout session
CREATE TABLE workouts (
  workout_id SERIAL PRIMARY KEY,
  session_id INT REFERENCES workout_sessions(session_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  low_rep_range INT,
  high_rep_range INT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE friends (
  friendship_id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
  friend_id INT REFERENCES users(user_id) ON DELETE CASCADE,
  status TEXT CHECK (status IN ('pending', 'accepted')) NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, friend_id)
);
CREATE TABLE friend_requests (
  request_id SERIAL PRIMARY KEY,
  sender_id INT REFERENCES users(user_id) ON DELETE CASCADE,
  receiver_id INT REFERENCES users(user_id) ON DELETE CASCADE,
  status TEXT CHECK (status IN ('pending', 'accepted', 'declined')) DEFAULT 'pending',
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP
);
CREATE TABLE completed_workouts (
  completed_id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
  session_id INT REFERENCES workout_sessions(session_id),
  exercise_name TEXT NOT NULL,
  sets INT NOT NULL,
  reps INT NOT NULL,
  weight INT NOT NULL,
  completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE completed_sets (
  set_id SERIAL PRIMARY KEY,
  completed_workout_id INT REFERENCES completed_workouts(completed_id) ON DELETE CASCADE,
  set_number INT NOT NULL,
  reps INT NOT NULL,
  weight INT NOT NULL
);
