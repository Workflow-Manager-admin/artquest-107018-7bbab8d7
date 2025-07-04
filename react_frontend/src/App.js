import React, { useEffect, useState, useRef, Fragment } from 'react';
import './App.css';
// Main App-wide Firebase import and config (assumes variables in .env)
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  doc,
  updateDoc,
  arrayUnion
} from "firebase/firestore";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "firebase/auth";
import {
  getStorage,
  ref as storageRef,
  uploadString,
  getDownloadURL
} from "firebase/storage";

// PUBLIC_INTERFACE
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

const CATEGORY_PROMPTS = [
  'Lion 🦁', 'Penguin 🐧', 'Dolphin 🐬', 'Turtle 🐢', 'Eagle 🦅', 'Horse 🐴', 'Tiger 🐯',
  'Chameleon 🦎', 'Frog 🐸', 'Owl 🦉', 'Peacock 🦚', 'Parrot 🦜', 'Snake 🐍', 'Koala 🐨', 'Kangaroo 🦘',
];

// Firebase singleton app
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// Helper: Get today's date in YYYY-MM-DD (for "Top Drawing Today")
function getTodayKey() {
  const now = new Date();
  return (
    now.getFullYear() +
    '-' +
    String(now.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(now.getDate()).padStart(2, '0')
  );
}

// Utility: shuffle array (for random prompt)
function shuffleArray(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// PUBLIC_INTERFACE
export default function App() {
  // Firebase user state
  const [user, setUser] = useState(null); // firebase user object
  const [username, setUsername] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameModal, setUsernameModal] = useState(true);
  // Dashboard & Drawing Data
  const [drawings, setDrawings] = useState([]); // [{id, ...}]
  const [topDrawing, setTopDrawing] = useState(null); // {id, ...}
  const [isLoading, setIsLoading] = useState(true);
  // Drawing Modal
  const [drawingModal, setDrawingModal] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [spinning, setSpinning] = useState(false);
  // Canvas/Drawing state
  const [canvasMode, setCanvasMode] = useState(false);
  const [drawTimeLeft, setDrawTimeLeft] = useState(45);
  const [drawData, setDrawData] = useState([]); // {x,y,dx,dy,dragging}
  // Timer
  const drawTimerRef = useRef();
  // Guess Modals
  const [guessInput, setGuessInput] = useState({});
  const [guessAttempted, setGuessAttempted] = useState({});
  const [correctGuess, setCorrectGuess] = useState({});
  // Animations - Card appearance
  const [animateCards, setAnimateCards] = useState(false);

  // Initialize: login anonymously (if not already), show username modal if first visit
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        setUser(fbUser);
        // Check for existing username in localStorage
        const saved = window.localStorage.getItem('artquest-username');
        if (saved) {
          setUsername(saved);
          setUsernameModal(false);
        } else {
          setUsernameModal(true);
        }
      }
    });
    signInAnonymously(auth)
      .catch(() => {
        alert('Firebase authentication failed. Please refresh to try again!');
      });
    return () => unsub();
  }, []);

  // Fetch all current drawings (realtime updates)
  useEffect(() => {
    setIsLoading(true);
    const q = query(collection(db, "drawings"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const items = [];
      let top = null, maxLikes = -1;
      const todayKey = getTodayKey();
      snap.forEach(docSnap => {
        const data = docSnap.data();
        items.push({ id: docSnap.id, ...data });
        // Top drawing for today (most correct guesses, fallback most recent)
        if (data.dateKey === todayKey) {
          const numCorrect = data.correctGuesses ? data.correctGuesses.length : 0;
          if (numCorrect > maxLikes) {
            maxLikes = numCorrect;
            top = { id: docSnap.id, ...data };
          }
        }
      });
      setDrawings(items);
      setTopDrawing(top);
      setIsLoading(false);
      setAnimateCards(true); // triggers entrance animation
      setTimeout(() => setAnimateCards(false), 1200);
    });
    return () => unsub();
  }, []);

  // Drawing timer logic
  useEffect(() => {
    if (!canvasMode) return;
    if (drawTimeLeft <= 0) {
      clearInterval(drawTimerRef.current);
    } else {
      drawTimerRef.current = setInterval(() => {
        setDrawTimeLeft((t) => {
          if (t <= 1) {
            clearInterval(drawTimerRef.current);
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    }
    return () => clearInterval(drawTimerRef.current);
  }, [canvasMode, drawTimeLeft]);

  // Set username
  const submitUsername = () => {
    if (usernameInput.trim().length < 2) {
      alert('Pick something more unique!');
      return;
    }
    setUsername(usernameInput.trim());
    setUsernameModal(false);
    window.localStorage.setItem('artquest-username', usernameInput.trim());
  };

  // Drawing process
  function openDrawModal() {
    setPrompt(''); // reset
    setSpinning(true);
    // Simulate spinning: pick a new prompt randomly
    const spinned = shuffleArray(CATEGORY_PROMPTS)[0];
    setTimeout(() => {
      setSpinning(false);
      setPrompt(spinned);
      setCanvasMode(true);
      setDrawTimeLeft(45);
      setDrawData([]);
      setDrawingModal(true);
    }, 1250);
  }
  // Complete drawing
  async function submitDrawing({ imgDataUrl }) {
    if (!user || !prompt) return;
    const drawingInfo = {
      prompt,
      author: username,
      guesses: [],
      incorrectGuesses: [],
      correctGuesses: [],
      createdAt: Date.now(),
      dateKey: getTodayKey(),
    };
    try {
      // Upload drawing metadata (store image in Firebase Storage)
      const docRef = await addDoc(collection(db, "drawings"), drawingInfo);
      const imgRef = storageRef(storage, `drawings/${docRef.id}.png`);
      await uploadString(imgRef, imgDataUrl, 'data_url');
      const url = await getDownloadURL(imgRef);
      // Save drawing url
      await updateDoc(doc(db, "drawings", docRef.id), {
        imageUrl: url
      });
    } catch (error) {
      alert('Failed to save drawing. Please try again!');
    }
    setCanvasMode(false);
    setDrawingModal(false);
  }

  // Guess logic
  const onGuessSubmit = async (drawingId) => {
    if (!user || guessAttempted[drawingId] || !guessInput[drawingId] || !drawings) return;
    const currInput = guessInput[drawingId].trim().toLowerCase();
    const thisDrawing = drawings.find(d => d.id === drawingId);
    if (!thisDrawing) return;

    // Only allow 1 guess per user per drawing
    setGuessAttempted(prev => ({ ...prev, [drawingId]: true }));
    // Update public incorrect guesses, or mark as correct!
    if (currInput === thisDrawing.prompt.toLowerCase()) {
      // Correct!
      setCorrectGuess(prev => ({ ...prev, [drawingId]: true }));
      await updateDoc(doc(db, "drawings", drawingId), {
        correctGuesses: arrayUnion(username),
        guesses: arrayUnion({ name: username, guess: currInput, correct: true })
      });
    } else {
      setCorrectGuess(prev => ({ ...prev, [drawingId]: false }));
      await updateDoc(doc(db, "drawings", drawingId), {
        incorrectGuesses: arrayUnion(currInput),
        guesses: arrayUnion({ name: username, guess: currInput, correct: false })
      });
    }
  };

  // Ground truth: check if viewer has already guessed for each drawing
  useEffect(() => {
    const attempt = {};
    const correctT = {};
    for (let dr of drawings) {
      if (!dr.guesses) continue;
      for (let g of dr.guesses) {
        if (g.name === username) {
          attempt[dr.id] = true;
          if (g.correct) correctT[dr.id] = true;
        }
      }
    }
    setGuessAttempted(attempt);
    setCorrectGuess(correctT);
  }, [drawings, username]);

  // Drawing Canvas Handlers
  // We inline the canvas here for brevity
  function DrawingCanvas({ onDone, prompt, timer, onCancel }) {
    // Local state for drawing
    const [drawing, setDrawing] = useState([]);
    const [isPainting, setIsPainting] = useState(false);
    const canvasRef = useRef(null);

    // Mouse event handlers
    const startDrawing = (e) => {
      setIsPainting(true);
      const pos = getPointerPos(e, canvasRef.current);
      setDrawing((d) => [...d, { ...pos, dragging: false }]);
    };
    const draw = (e) => {
      if (!isPainting) return;
      const pos = getPointerPos(e, canvasRef.current);
      setDrawing((d) => [...d, { ...pos, dragging: true }]);
    };
    const stopDrawing = () => setIsPainting(false);

    // Touch events
    const startTouch = (e) => {
      e.preventDefault();
      startDrawing(e.touches[0]);
    };
    const moveTouch = (e) => {
      e.preventDefault();
      draw(e.touches[0]);
    };
    const stopTouch = (e) => {
      e.preventDefault();
      stopDrawing();
    };

    // Redraw Canvas
    useEffect(() => {
      const ctx = canvasRef.current.getContext('2d');
      ctx.clearRect(0, 0, 320, 320);
      ctx.lineJoin = "round";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "#fd86e3";
      for (let i = 0; i < drawing.length; i++) {
        ctx.beginPath();
        if (drawing[i].dragging && i) {
          ctx.moveTo(drawing[i - 1].x, drawing[i - 1].y);
        } else {
          ctx.moveTo(drawing[i].x - 1, drawing[i].y);
        }
        ctx.lineTo(drawing[i].x, drawing[i].y);
        ctx.closePath();
        ctx.stroke();
      }
    }, [drawing]);

    // When timer runs out, onDone
    useEffect(() => {
      if (timer === 0) {
        // Export as image dataURL
        const imgDataUrl = canvasRef.current.toDataURL("image/png");
        onDone({ imgDataUrl });
      }
    }, [timer, onDone]);

    return (
      <div className="modal-overlay">
        <div className="drawing-modal">
          <h2 className="fun-title">{prompt} <span role="img" aria-label="draw">🎨</span></h2>
          <div
            className="canvas-container"
            style={{ position: 'relative', margin: '24px 0' }}
          >
            <canvas
              ref={canvasRef}
              width={320}
              height={320}
              style={{ borderRadius: 24, border: '2px solid #fd86e3', background: '#fcfcfc', touchAction: 'none' }}
              onMouseDown={startDrawing}
              onTouchStart={startTouch}
              onMouseMove={draw}
              onTouchMove={moveTouch}
              onMouseUp={stopDrawing}
              onTouchEnd={stopTouch}
              onMouseLeave={stopDrawing}
            ></canvas>
            <TimerCircle progress={timer / 45} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <button className="btn btn-lg btn-accent"
              onClick={() => {
                // Export as image dataURL and finish
                const imgDataUrl = canvasRef.current.toDataURL("image/png");
                onDone({ imgDataUrl });
              }}
              disabled={timer === 0}
            >Finish now</button>
            {' '}
            <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }
  // Helper
  function getPointerPos(e, target) {
    // Mouse or touch relative to canvas
    const rect = target.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;
    return { x, y };
  }

  // Circular timer animation
  function TimerCircle({ progress }) {
    // progress: 1 to 0, draws arc
    const r = 44, size = 100;
    const c = r * 2 * Math.PI * progress;
    return (
      <svg width={size} height={size} style={{
        position: "absolute", top: 8, right: 8, pointerEvents: "none"
      }}>
        <circle cx={size/2} cy={size/2} r={r}
          fill="none"
          stroke="#eee"
          strokeWidth="8"
        />
        <circle cx={size/2} cy={size/2} r={r}
          fill="none"
          stroke="#fd86e3"
          strokeWidth="8"
          strokeDasharray={2*r*Math.PI}
          strokeDashoffset={2*r*Math.PI - c}
        />
        <text
          x="50%"
          y="54%"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="32"
          fontWeight="bold"
          fill="#fd86e3"
        >{Math.ceil(progress * 45)}</text>
      </svg>
    );
  }

  // Card animated entrance
  function getCardAnimClass(idx) {
    if (!animateCards) return "";
    const delay = Math.min(idx * 120, 650);
    return `card-anim card-anim-delay-${delay}`;
  }

  // Username input modal
  function UsernameModal() {
    return (
      <div className="modal-overlay">
        <div className="username-modal">
          <h2>Welcome to ArtQuest 🎉</h2>
          <label htmlFor="username">Pick a fun username to start:</label>
          <div style={{ marginTop: 12 }}>
            <input
              id="username"
              type="text"
              placeholder="(e.g. PandaFan99 🐼)"
              value={usernameInput}
              onChange={e => setUsernameInput(e.target.value)}
              maxLength={22}
              autoFocus
              className="input"
              style={{ marginBottom: 8, fontSize: 17 }}
              onKeyDown={e => e.key === 'Enter' && submitUsername()}
            />
          </div>
          <button className="btn btn-accent" onClick={submitUsername}>Start</button>
        </div>
      </div>
    );
  }

  // Spinning prompt overlay
  function SpinModal() {
    return (
      <div className="modal-overlay">
        <div className="spin-modal">
          <div className={`spin-wheel${spinning ? ' spinning' : ''}`}>
            <span>{spinning ? "🎲" : prompt}</span>
          </div>
          <p style={{ fontWeight: 500, fontSize: 20, marginTop: 10 }}>
            {spinning ? "Spinning for your drawing..." : "Ready to draw!"}
          </p>
        </div>
      </div>
    );
  }

  // Main App UI: grid with top drawing, card grid, FAB
  return (
    <Fragment>
      <div className="App" style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
        <header className="app-header-bar">
          <span className="game-title" aria-label="ArtQuest">🎨 ArtQuest</span>
          <span className="username">{username ? <span>Hi, <b>{username}</b>!</span> : ''}</span>
        </header>
        <main className="dashboard-main">
          {/* Top Drawing of the Day */}
          <section className="section-topdrawing">
            <h2 className="section-title">Top Drawing Today</h2>
            {topDrawing ? (
              <div className="top-card animate-pop">
                <img alt={topDrawing.prompt} src={topDrawing.imageUrl} className="top-card-img" />
                <div className="top-card-info">
                  <span className="top-card-title">{topDrawing.prompt}</span>
                  <span className="top-card-artist">by {topDrawing.author}</span>
                  <span className="top-card-likes">
                    <span role="img" aria-label="Guesses">👍</span> {topDrawing.correctGuesses ? topDrawing.correctGuesses.length : 0}
                  </span>
                </div>
              </div>
            ) : (
              <div className="top-card placeholder">No top drawing yet today!</div>
            )}
          </section>
          {/* Drawing Cards Grid */}
          <section className="section-drawings">
            <h2 className="section-title">New Drawings</h2>
            <div className="grid">
              {isLoading && <div className="loading">...Loading...</div>}
              {!isLoading && drawings.filter(d=>!!d.imageUrl).map((dr, idx) => (
                <div className={"drawing-card " + getCardAnimClass(idx)} key={dr.id}>
                  <div className="drawing-image-wrap">
                    <img src={dr.imageUrl} alt="drawing" className="drawing-thumb" />
                  </div>
                  <div className="drawing-card-info">
                    <span className="prompt-label">What's this?</span>
                    {/* Guess Input (only if not mine, one attempt) */}
                    {(dr.author !== username && !guessAttempted[dr.id]) &&
                      <div className="guess-form">
                        <input
                          type="text"
                          placeholder="Guess (1 try)..."
                          className="input guess-input"
                          value={guessInput[dr.id] || ''}
                          onChange={(e) =>
                            setGuessInput(gi => ({ ...gi, [dr.id]: e.target.value }))
                          }
                          maxLength={20}
                          onKeyDown={e => e.key === 'Enter' && onGuessSubmit(dr.id)}
                        />
                        <button className="btn btn-mini" onClick={() => onGuessSubmit(dr.id)}>Go</button>
                      </div>
                    }
                    {guessAttempted[dr.id] && (
                      <div className="guess-attempted">
                        {correctGuess[dr.id]
                          ? <span className="correct-guess">🎉 Correct!</span>
                          : <span className="incorrect-guess">❌ Incorrect!</span>
                        }
                      </div>
                    )}
                    {/* Others' incorrect guesses list */}
                    <div className="guess-list">
                      <span className="guesses-label">Wrong guesses:</span>
                      <div className="guesses">
                        {dr.incorrectGuesses && dr.incorrectGuesses.slice(-5).map((g, i) =>
                          <span className="guess-pill" key={g + i}>{g}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Author at bottom */}
                  <span className="drawing-card-author">by {dr.author}</span>
                </div>
              ))}
            </div>
          </section>
          {/* Floating Action Button for Drawing */}
          <button className="fab" aria-label="Draw" onClick={openDrawModal}>+</button>
        </main>
        {/* Footer */}
        <footer className="app-footer">
          <span>Made with <span role="img" aria-label="love">💖</span> for your imagination.</span>
        </footer>
      </div>
      {/* Overlays/Modals */}
      {usernameModal && <UsernameModal />}
      {spinning && <SpinModal />}
      {drawingModal && prompt && (
        <DrawingCanvas
          onDone={submitDrawing}
          prompt={prompt}
          timer={drawTimeLeft}
          onCancel={() => { setCanvasMode(false); setDrawingModal(false); }}
        />
      )}
    </Fragment>
  );
}
