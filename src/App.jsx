import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
// --- Firebase SDK Imports (Using standard package imports) ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth'; // signInWithCustomToken removed as we only use anonymous sign-in now
import { getFirestore, collection, doc, setDoc, query, orderBy, limit, onSnapshot, serverTimestamp, setLogLevel } from 'firebase/firestore';


// --- API Configuration ---
// Read securely from Vercel Environment Variables
const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
const apiKey = env.VITE_VAIDYA_MITHRA_GEMINI_KEY || "";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

// --- Structured JSON Schema for Disease Prediction ---
const JSON_SCHEMA = {
  type: "OBJECT",
  properties: {
    emergency_flag: {
      type: "BOOLEAN",
      description: "True if symptoms indicate a severe, life-threatening emergency (e.g., severe chest pain, inability to breathe, stroke signs). False otherwise."
    },
    predictions: {
      type: "ARRAY",
      description: "List of the top 3 most probable diseases based on symptoms, age, and gender.",
      items: {
        type: "OBJECT",
        properties: {
          disease: { type: "STRING", description: "The name of the potential condition." },
          confidence: { type: "NUMBER", description: "A confidence score between 0.0 and 1.0 (e.g., 0.85 for 85%)." },
          description: { type: "STRING", description: "A brief, non-alarming, and clear overview of the disease and suggested next steps (e.g., call a doctor in 24 hours, monitor symptoms)." }
        },
        required: ["disease", "confidence", "description"]
      }
    }
  },
  required: ["emergency_flag", "predictions"]
};

// --- Symptom Data & Categories ---
const ALL_SYMPTOMS_CATEGORIZED = {
  General: [
    'Fatigue', 'Fever', 'Headache', 'Dizziness', 'Nausea', 'Vomiting', 'Body Ache',
    'Chills', 'Sore Throat', 'Diarrhea', 'Constipation', 'Runny Nose'
  ],
  Respiratory: [
    'Cough', 'Shortness of Breath', 'Wheezing', 'Chest Tightness', 'Difficulty Breathing',
    'Sputum Production', 'Sneezing', 'Hoarseness'
  ],
  Cardiac: [
    'Chest Pain', 'Palpitations', 'Fainting', 'Swelling of Legs/Ankles',
    'Rapid Heartbeat', 'Lightheadedness', 'Pain Radiating to Jaw/Arm'
  ],
  Skin: [
    'Rash', 'Itching', 'Hives', 'Dry Skin', 'Jaundice', 'Bruising',
    'Change in Mole appearance', 'Redness/Inflammation'
  ],
  Musculoskeletal: [
    'Joint Pain', 'Muscle Pain', 'Back Pain', 'Stiffness', 'Swollen Joints',
    'Limited Range of Motion', 'Numbness/Tingling'
  ],
};

const SYMPTOM_CATEGORIES = Object.keys(ALL_SYMPTOMS_CATEGORIZED);

// =================================================================================
// --- HELPER & LAYOUT COMPONENTS ---
// =================================================================================

/**
 * 1. Icon Component (Simulating Lucide Icons)
 * (Added 'home' icon)
 */
const Icon = ({ name, size = 20, color = 'currentColor', className = '' }) => {
  const icons = {
    home: (
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    ),
    stethoscope: (
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M12 2a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3h-6zM9 12h-4a2 2 0 0 0-2 2v2M21 12h-4a2 2 0 0 1-2 2v2M12 9v6M15 15v-6M18 15v-6M9 15v-6"/></svg>
    ),
    messageSquare: (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    ),
    hospital: (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M12 11v6m-3-3h6m7 0h-3v4a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-4H3m7-10l-1 4H5l-1 4m16-8l-1 4h-4l-1 4m4 4H4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2z"/></svg>
    ),
    history: (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M12 2v10l4-4m-6-6a9 9 0 1 1 0 18a9 9 0 0 1 0-18z"/></svg>
    ),
    mail: (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
    ),
    phone: (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-4.75-4.75A19.79 19.79 0 0 1 2.08 3.18 2 2 0 0 1 4.08 1h3a2 2 0 0 1 2 1.72 17.51 17.51 0 0 0 .15 3.37 2 2 0 0 1-1.28 2.13l-1.3 1.3A15 15 0 0 0 15 16.5l1.3-1.3a2 2 0 0 1 2.13-1.28A17.51 17.51 0 0 0 20.28 16.92z"/></svg>
    ),
    alertTriangle: (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    ),
    chevronRight: (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="9 18 15 12 9 6"/></svg>
    ),
    send: (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
    ),
    x: (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    ),
    lightbulb: (
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M15.09 16.05A6.47 6.47 0 0 1 12 21.03a6.47 6.47 0 0 1-3.09-4.98c0-.62.07-1.23.21-1.81l.15-.62.62-.15c.58-.14 1.19-.21 1.81-.21h0c.62 0 1.23.07 1.81.21l.62.15.15.62c.14.58.21 1.19.21 1.81zM12 21.03V22m0-11.03V4a2 2 0 1 1 4 0v2.03M8 6.03V4a2 2 0 1 0-4 0v2.03m5.5 10.44C13.5 16 13 14.83 13 14c0-1.04.2-1.9.5-2.65M10.5 16c.5.5 1 1.17 1 2 0 1.04-.2 1.9-.5 2.65m-2-12.09c.39-.28.8-.53 1.24-.75M14.76 3.18c.44.22.85.47 1.24.75m-6 12.09c-.39.28-.8.53-1.24.75M9.24 3.18c-.44.22-.85.47-1.24.75M12 6.03V4m0 17.03V21m-3.5-13.44c-.5.5-1 1.17-1 2 0 1.04.2 1.9.5 2.65m6.5-2.65c.5.5 1 1.17 1 2 0 1.04-.2 1.9-.5 2.65"/></svg>
    ),
  };
  return icons[name] || <div style={{ width: size, height: size }}>?</div>;
};

/**
 * 2. New Logo Component
 */
const Logo = () => (
  <div className="flex items-center flex-shrink-0">
    <div className="p-1 bg-blue-600 rounded-lg">
      <Icon name="stethoscope" size={24} color="white" />
    </div>
    <span className="text-2xl font-bold text-blue-800 ml-3">
      Vaidya <span className="text-blue-600">Mithra</span>
    </span>
  </div>
);

/**
 * 3. Navigation Bar (Modified for State-based Navigation and Mobile Menu)
 */
const NavBar = ({ currentPage, onNavigate }) => {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    
    const navItems = [
        { id: "home", name: "Home", icon: "home" },
        { id: "prediction", name: "Prediction", icon: "stethoscope" },
        { id: "docbot", name: "DocBot", icon: "messageSquare" },
        { id: "hospitals", name: "Hospitals", icon: "hospital" },
        { id: "contact", name: "Contact", icon: "mail" },
    ];

    const handleNavigation = (id) => {
        onNavigate(id);
        setIsMenuOpen(false); // Close menu on navigation
    };

    return (
        <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md shadow-lg border-b border-gray-200/80 flex-shrink-0">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center h-16">
                    <a href="#" onClick={(e) => { e.preventDefault(); handleNavigation('home'); }} className="no-underline">
                        <Logo />
                    </a>
                    
                    {/* Desktop Menu */}
                    <div className="hidden md:flex space-x-4">
                        {navItems.map((item) => {
                            const isActive = currentPage === item.id;
                            return (
                                <a
                                    key={item.id}
                                    href="#"
                                    onClick={(e) => { e.preventDefault(); handleNavigation(item.id); }}
                                    className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center transition duration-150 ${
                                        isActive
                                            ? 'bg-blue-100 text-blue-700'
                                            : 'text-gray-700 hover:bg-blue-50 hover:text-blue-600'
                                    }`}
                                >
                                    <Icon name={item.icon} size={18} className="mr-2" color="currentColor" />
                                    {item.name}
                                </a>
                            );
                        })}
                    </div>
                    
                    {/* Mobile Menu Button */}
                    <button
                        className="md:hidden p-2 rounded-lg text-gray-700 hover:bg-gray-100 transition"
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                    >
                         {isMenuOpen ? (
                             <Icon name="x" size={24} />
                         ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
                         )}
                    </button>
                </div>
            </div>

            {/* Mobile Menu Overlay */}
            {isMenuOpen && (
                <div 
                    className="md:hidden absolute top-16 left-0 w-full bg-white/95 backdrop-blur-lg shadow-lg border-t border-gray-200/80 transform origin-top transition-all duration-300 ease-out"
                    style={{ maxHeight: 'calc(100vh - 4rem)' }}
                >
                    <div className="flex flex-col p-4 space-y-2">
                        {navItems.map((item) => (
                            <a
                                key={item.id}
                                href="#"
                                onClick={(e) => { e.preventDefault(); handleNavigation(item.id); }}
                                className={`px-4 py-3 rounded-lg text-lg font-medium flex items-center transition duration-150 ${
                                    currentPage === item.id
                                        ? 'bg-blue-100 text-blue-700'
                                        : 'text-gray-800 hover:bg-blue-50'
                                }`}
                            >
                                <Icon name={item.icon} size={20} className="mr-3" color="currentColor" />
                                {item.name}
                            </a>
                        ))}
                    </div>
                </div>
            )}
        </nav>
    );
};

/**
 * 4. Skeleton Loader Component
 */
const SkeletonCard = () => (
  <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 shadow-sm animate-pulse">
    <div className="flex justify-between items-center mb-3">
      <div className="h-5 w-3/5 bg-gray-300 rounded-md"></div>
      <div className="h-4 w-1/4 bg-gray-300 rounded-full"></div>
    </div>
    <div className="space-y-2">
      <div className="h-3 w-full bg-gray-300 rounded-md"></div>
      <div className="h-3 w-5/6 bg-gray-300 rounded-md"></div>
    </div>
  </div>
);

/**
 * 5. MODIFIED: Footer Component (Now a slim bar)
 */
const Footer = ({ className = '' }) => (
  <div id="footer" className={`bg-white/70 backdrop-blur-sm border-t border-gray-200 py-4 px-4 sm:px-8 ${className}`}>
    <p className="text-xs text-gray-600 text-center max-w-4xl mx-auto mb-2">
      <strong>Disclaimer:</strong> This application is for informational and educational purposes only and is <strong>NOT</strong> a substitute for professional medical advice, diagnosis, or treatment. Always seek the advice of your physician with any questions you may have regarding a medical condition.
    </p>
    <p className="text-xs text-gray-500 text-center">
      &copy; 2025 Vaidya Mithra. All rights reserved.
    </p>
  </div>
);


// =================================================================================
// --- "PAGE" COMPONENTS ---
// =================================================================================

/**
 * PAGE 1: Home Page (Modified to fill flex-grow)
 */
const HomePage = ({ onNavigate }) => (
  <div className="h-full flex flex-col items-center justify-center bg-gradient-to-r from-blue-500 to-cyan-500 overflow-hidden p-4 sm:p-8">
    <div className="absolute inset-0 opacity-10 bg-cover bg-center" style={{backgroundImage: "url('https://placehold.co/1920x800/ffffff/000000?text=Health+Data+Analysis')"}}></div>
    
    <div className="z-10 text-center text-white p-4 max-w-4xl">
      <h1 
        className="text-4xl md:text-6xl font-extrabold mb-4 drop-shadow-lg tracking-tight opacity-0"
        style={{ animation: 'fadeInUp 0.6s 0.2s ease-out forwards' }}
      >
        Welcome to Vaidya Mithra
      </h1>
      <p 
        className="text-lg md:text-xl mb-8 font-light drop-shadow-md opacity-0"
        style={{ animation: 'fadeInUp 0.6s 0.4s ease-out forwards' }}
      >
        Get non-diagnostic insights and next steps in seconds. Powered by Gemini AI for responsible health guidance.
      </p>
      <a
        href="#prediction"
        onClick={(e) => { e.preventDefault(); onNavigate('prediction'); }}
        className="inline-flex items-center px-8 py-3 bg-green-500 text-white text-lg font-semibold rounded-full shadow-xl hover:bg-green-600 transition-all duration-300 transform hover:scale-105 opacity-0"
        style={{ animation: 'fadeInUp 0.6s 0.6s ease-out forwards' }}
      >
        Start Health Check
        <Icon name="chevronRight" size={24} className="ml-2" color="white" />
      </a>
    </div>
  </div>
);

/**
 * PAGE 2: Hospital Finder Page (Modified to center in viewport)
 */
const HospitalPage = () => {
  const [status, setStatus] = useState('ready'); // ready, loading, found, error

  const findHospitals = () => {
    if (!navigator.geolocation) {
      setStatus('error');
      console.warn("User Alert: Geolocation is not supported by your browser. Please search manually.");
      return;
    }

    setStatus('loading');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        setStatus('found');

        // Construct Google Maps URL for nearby hospitals
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=hospitals+near+${lat},${lon}`;
        
        // Redirect user to Google Maps in a new tab
        window.open(mapsUrl, '_blank');
      },
      (error) => {
        console.error("Geolocation error:", error);
        setStatus('error');
        console.warn(`User Alert: Error getting location: ${error.message}. Please search manually.`);
      },
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0
      }
    );
  };

  return (
    // This container centers the card vertically and horizontally
    <div id="hospitals-page" className="h-full flex items-center justify-center p-4 sm:p-8">
      <div 
        className="bg-white/80 backdrop-blur-lg shadow-2xl rounded-2xl p-6 sm:p-8 border border-gray-200/50 transition-all duration-300 hover:shadow-cyan-100 max-w-2xl w-full opacity-0"
        style={{ animation: 'fadeInUp 0.5s ease-out forwards' }}
      >
        <h2 className="text-2xl sm:text-3xl font-extrabold text-blue-800 mb-6 flex items-center">
          <Icon name="hospital" size={30} className="mr-3 text-blue-500" />
          Nearby Hospitals & Clinics
        </h2>
        <p className="text-gray-600 mb-6 text-sm sm:text-base">
          Quickly find the nearest medical facilities. We will use your current location to launch a localized Google Maps search.
        </p>

        <div className="flex flex-col sm:flex-row items-center space-y-4 sm:space-y-0 sm:space-x-4">
          <button
            onClick={findHospitals}
            disabled={status === 'loading'}
            className="w-full sm:w-auto bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-xl transition-all duration-300 disabled:opacity-50 flex items-center justify-center transform hover:scale-105"
          >
            {status === 'loading' ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                Finding Location...
              </>
            ) : (
              <>
                Find Hospitals Now <Icon name="chevronRight" size={20} className="ml-2" color="white" />
              </>
            )}
          </button>
          {status === 'found' && (
            <p className="text-sm text-green-600">Redirected to Google Maps based on your location!</p>
          )}
          {status === 'error' && (
            <p className="text-sm text-red-600">Error: Could not retrieve location data.</p>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * PAGE 3: DocBot Chat Page (Modified to fill viewport)
 */
const DocBotPage = ({ db, userId, auth, authReady, appId }) => { // <-- Added appId prop
  const CHAT_BOT_SYSTEM_INSTRUCTION = "You are a friendly, non-diagnostic AI assistant named DocBot. Your role is to answer general health questions, provide basic medical information, explain symptoms, and offer clear advice on when to see a doctor. Never provide a formal diagnosis, treatment, or specific medication advice. Keep responses encouraging and concise. Only provide one possible condition and safe general advice. Use Google Search grounding when necessary.";

  const [chatHistory, setChatHistory] = useState([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);

  const suggestedQuestions = [
    "What are the symptoms of the flu?",
    "How can I relieve a headache?",
    "What is hypertension?",
  ];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [chatHistory]);

  // Firestore Listener
  useEffect(() => {
    // MODIFIED: Uses new appId prop and checks authReady
    if (!authReady || !userId || !db || !appId) return;

    try {
      // MODIFIED: Uses appId prop to build path
      const chatCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/docbot_chat`);
      const q = query(chatCollectionRef, orderBy('timestamp', 'asc'), limit(50));

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const history = snapshot.docs.map(doc => ({...doc.data(), id: doc.id })); // Add id
        setChatHistory(history);
      }, (error) => {
        console.error("Error fetching chat history from Firestore:", error);
      });

      return () => unsubscribe();
    } catch (e) {
      console.error("Firestore Chat Setup Failed:", e);
    }
  }, [db, userId, authReady, appId]); // <-- Added appId dependency

  // Exponential Backoff Fetch Utility
  const fetchWithBackoff = useCallback(async (url, options, retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, options);
        if (response.ok) {
          return response;
        } else if (response.status === 429 && i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
          continue;
        } else {
          throw new Error(`API returned status ${response.status}`);
        }
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }, []);

  const handleSend = async (messageText) => {
    const message = (typeof messageText === 'string') ? messageText : currentMessage;
    // MODIFIED: Uses new appId prop
    if (!message.trim() || isTyping || !db || !userId || !appId) return;

    const userMessage = message.trim();
    setCurrentMessage('');
    
    // MODIFIED: Uses appId prop to build path
    const chatCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/docbot_chat`);
    
    // 1. Save user message to Firestore
    const userDocRef = doc(chatCollectionRef);
    await setDoc(userDocRef, {
      text: userMessage,
      role: 'user',
      timestamp: serverTimestamp(),
      id: userDocRef.id
    });

    setIsTyping(true);

    try {
      const apiHistory = chatHistory.map(msg => ({
        role: msg.role === 'ai' ? 'model' : 'user',
        parts: [{ text: msg.text }]
      }));
      
      apiHistory.push({ role: 'user', parts: [{ text: userMessage }] });


      const payload = {
        contents: apiHistory,
        tools: [{ "google_search": {} }],
        systemInstruction: {
          parts: [{ text: CHAT_BOT_SYSTEM_INSTRUCTION }]
        },
      };

      const response = await fetchWithBackoff(GEMINI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      const aiText = result.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't process that request right now. Please try again later.";
      
      // 2. Save AI response to Firestore
      const aiDocRef = doc(chatCollectionRef);
      await setDoc(aiDocRef, {
        text: aiText,
        role: 'ai',
        timestamp: serverTimestamp(),
        id: aiDocRef.id
      });
      
    } catch (error) {
      console.error("Chatbot API failed:", error);
       // Save error message to Firestore
      const errorDocRef = doc(chatCollectionRef);
      await setDoc(errorDocRef, {
        text: "I ran into a technical error. Please try refreshing or checking your network connection.",
        role: 'ai_error',
        timestamp: serverTimestamp(),
        id: errorDocRef.id
      });
    } finally {
      setIsTyping(false);
    }
  };

  const ChatBubble = ({ message }) => {
    const isUser = message.role === 'user';
    const isError = message.role === 'ai_error';
    const bubbleClass = isUser
      ? 'bg-blue-500 text-white self-end rounded-br-none'
      : 'bg-gray-100 text-gray-800 self-start rounded-tl-none';
    
    const errorClass = isError 
      ? 'bg-red-100 text-red-700 self-start border border-red-300'
      : '';

    return (
      <div className={`max-w-xs sm:max-w-md p-3 rounded-xl shadow-md my-2 ${bubbleClass} ${errorClass}`}>
        <p className="whitespace-pre-wrap">{message.text}</p>
      </div>
    );
  };

  return (
    // This container fills the available height
    <div id="chatbot-page" className="h-full p-4 sm:p-8 flex flex-col">
      {/* This card grows to fill the height, creating the "still" page effect */}
      <div 
        className="bg-white/80 backdrop-blur-lg shadow-2xl rounded-2xl p-4 sm:p-8 border border-gray-200/50 flex flex-col flex-grow h-full transition-all duration-300 opacity-0"
        style={{ animation: 'fadeInUp 0.5s ease-out forwards' }}
      >
        <h2 className="text-3xl font-extrabold text-blue-800 mb-6 flex items-center flex-shrink-0">
          <Icon name="messageSquare" size={30} className="mr-3 text-green-500" />
          DocBot - Your AI Health Assistant
        </h2>

        {/* Chat History Area - This now grows and scrolls internally */}
        <div className="flex-grow overflow-y-auto p-4 mb-4 bg-gray-50/70 rounded-lg border border-gray-200 flex flex-col space-y-3">
          {chatHistory.length === 0 && !isTyping ? (
            <div 
              className="text-center text-gray-500 m-auto opacity-0"
              style={{ animation: 'fadeIn 0.5s 0.3s ease-out forwards' }}
            >
              <Icon name="stethoscope" size={40} className="mx-auto mb-2 text-blue-400" />
              <p>Hello! I am DocBot. Ask me any general health questions.</p>
              
              {/* Suggested Questions */}
              <div className="mt-6">
                <h4 className="text-sm font-semibold text-gray-600 mb-3 flex items-center justify-center">
                  <Icon name="lightbulb" size={16} className="mr-2 text-yellow-500" />
                  Try asking...
                </h4>
                <div className="flex flex-col sm:flex-row gap-2 justify-center">
                  {suggestedQuestions.map((q) => (
                    <button
                      key={q}
                      onClick={() => handleSend(q)}
                      className="px-4 py-2 bg-blue-50 text-blue-700 rounded-full text-sm font-medium transition-all duration-200 hover:bg-blue-100 hover:shadow-sm transform hover:scale-105"
                    >
                      "{q}"
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            chatHistory.map((msg, index) => (
              <ChatBubble key={msg.id || index} message={msg} />
            ))
          )}
          {isTyping && (
            <div className="max-w-xs p-3 rounded-xl shadow-md bg-gray-100 text-gray-800 self-start rounded-tl-none animate-pulse">
              <span className="dot-flashing"></span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area - This stays at the bottom */}
        <div className="flex space-x-2 flex-shrink-0">
          <input
            type="text"
            value={currentMessage}
            onChange={(e) => setCurrentMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            className="flex-grow p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-150"
            placeholder={!authReady ? "Loading connection..." : "Ask DocBot a health question..."}
            disabled={isTyping || !authReady}
          />
          <button
            onClick={() => handleSend()}
            disabled={isTyping || !currentMessage.trim() || !authReady}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl transition-all duration-300 disabled:opacity-50 flex items-center justify-center transform hover:scale-105"
          >
            <Icon name="send" size={20} color="white" />
          </button>
        </div>
      </div>
    </div>
  );
};


/**
 * PAGE 4: Contact Page (Modified to center in viewport)
 */
const ContactPage = () => {
  const TEAM_CONTACTS = useMemo(() => [
    { name: "Divya M C", role: "Software Engineer", phone: "9606390229", email: "divyamc2006@gmail.com" },
    { name: "Dilip Kumar A N",role: "Software Engineer", phone: "7259447817", email: "dilipgowda7259@gmail.com" },
    { name: "Manu M C", role: "Software Engineer", phone: "8867499702", email: "manumcmanumc42@gmail.com" },
    { name: "Hemanth Kumar K S",role: "Software Engineer",  phone: "8792564277", email: "hemanthgowdaks77@gmail.com" },
  ], []);

  return (
    // This container centers the card vertically and horizontally
    <div id="contact-page" className="h-full flex p-4 sm:p-6"> {/* MODIFIED: Simplified container and padding */}
      <div 
        className="bg-white/80 backdrop-blur-lg shadow-2xl rounded-2xl p-6 border border-gray-200/50 transition-all duration-300 max-w-5xl w-full flex flex-col m-auto opacity-0" /* MODIFIED: m-auto, max-w-4xl to max-w-5xl, p-6 */
        style={{ animation: 'fadeInUp 0.5s ease-out forwards' }}
      >
        <h2 className="text-3xl font-extrabold text-blue-800 mb-4 flex items-center flex-shrink-0"> {/* MODIFIED: mb-6 to mb-4 */ }
          <Icon name="mail" size={30} className="mr-3 text-blue-500" />
          Contact the Team
        </h2>
        <p className="text-gray-600 mb-6 flex-shrink-0"> {/* MODIFIED: mb-8 to mb-6 */ }
          For technical support, legal inquiries, or other questions, please reach out to the relevant department.
        </p>

        {/* This grid is now horizontal on larger screens */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"> {/* MODIFIED: Added lg:grid-cols-4 */}
          {TEAM_CONTACTS.map((person) => (
            <div 
              key={person.name} 
              className="bg-gray-50/80 border border-gray-200/50 p-4 rounded-xl shadow-md transition-all duration-300 hover:shadow-lg hover:scale-[1.03] hover:border-blue-300"
            >
              <p className="font-bold text-lg text-blue-800 mb-2">{person.name}</p> {/* MODIFIED: text-xl to text-lg, mb-3 to mb-2 */ }
              
               <div className="flex items-center text-sm text-gray-700 mb-1"> {/* MODIFIED: text-md to text-sm, mb-2 to mb-1 */ }
                <Icon name="phone" size={14} className="mr-2 text-gray-500" />
                <a href={`tel:${person.role}`} className="hover:text-blue-600 transition">{person.role}</a>
                 
              <div className="flex items-center text-sm text-gray-700 mb-1"> {/* MODIFIED: text-md to text-sm, mb-2 to mb-1 */ }
                <Icon name="phone" size={14} className="mr-2 text-gray-500" />
                <a href={`tel:${person.phone}`} className="hover:text-blue-600 transition">{person.phone}</a>
              </div>
              <div className="flex items-center text-sm text-gray-700"> {/* MODIFIED: text-md to text-sm */ }
                <Icon name="mail" size={14} className="mr-2 text-gray-500" />
                <a href={`mailto:${person.email}`} className="hover:text-blue-600 transition">{person.email}</a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * PAGE 5: Prediction Page (HEAVILY RE-ARCHITECTED)
 * This page now uses flexbox to fill the viewport.
 * The symptom lists and history scroll INTERNALLY.
 * The main page only scrolls AFTER prediction.
 */
const PredictionPage = ({ db, auth, userId, authReady, appId }) => { // <-- Added appId prop
  // Prediction States
  const [selectedSymptoms, setSelectedSymptoms] = useState([]);
  const [age, setAge] = useState(30);
  const [gender, setGender] = useState('Male');
  const [predictionResult, setPredictionResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState(SYMPTOM_CATEGORIES[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [history, setHistory] = useState([]);

  // --- HISTORY LISTENER ---
  useEffect(() => {
    // MODIFIED: Uses new appId prop and checks authReady
    if (!authReady || !userId || !db || !appId) return;

    try {
      // MODIFIED: Uses appId prop to build path
      const historyCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/symptom_history`);
      const q = query(historyCollectionRef, orderBy('timestamp', 'desc'), limit(5));

      const unsubscribe = onSnapshot(q, (snapshot) => {
        setHistory(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
      }, (error) => {
        console.error("Error fetching history:", error);
      });

      return () => unsubscribe();
    } catch (e) {
      console.error("Firestore History Listener Failed:", e);
    }
  }, [db, userId, authReady, appId]); // <-- Added appId dependency

  // Exponential Backoff Fetch Utility
  const fetchWithBackoff = useCallback(async (url, options, retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, options);
        if (response.ok) {
          return response;
        } else if (response.status === 429 && i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
          continue;
        } else {
          throw new Error(`API returned status ${response.status}`);
        }
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }, []);

  // --- PREDICTION LOGIC ---
  const handlePrediction = useCallback(async () => {
    if (selectedSymptoms.length === 0) {
      setPredictionResult(null);
      return;
    }

    setIsLoading(true);
    setPredictionResult(null); // Clear previous results

    // Scroll to results after a short delay to allow UI to update
    setTimeout(() => {
        const resultsEl = document.getElementById('prediction-results');
        resultsEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    const userQuery = `The patient is a ${age} year old ${gender}. They are currently experiencing the following symptoms: ${selectedSymptoms.join(', ')}. Please act as a professional medical analyst and provide the top 3 most likely differential diagnoses, a confidence score (0.0 to 1.0) for each, and non-alarming, concise next steps/advice. Focus strictly on the JSON output format.`;

    try {
      const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: JSON_SCHEMA,
        },
      };

      const response = await fetchWithBackoff(GEMINI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      const jsonString = result.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!jsonString) {
        throw new Error("Invalid response format from AI.");
      }

      const parsedResult = JSON.parse(jsonString);
      setPredictionResult(parsedResult);
      
      // Save query to Firestore if initialized
      // MODIFIED: Uses new appId prop
      if (db && userId && appId) {
        // MODIFIED: Uses appId prop to build path
        const historyCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/symptom_history`);
        await setDoc(doc(historyCollectionRef), {
          symptoms: selectedSymptoms,
          age: age,
          gender: gender,
          result: parsedResult,
          timestamp: serverTimestamp(),
        });
      }
    } catch (error) {
      console.error("Prediction failed:", error);
      setPredictionResult({ error: `Could not retrieve AI prediction. ${error.message}` });
    } finally {
      setIsLoading(false);
    }
  }, [selectedSymptoms, age, gender, db, userId, appId, fetchWithBackoff]); // <-- Added appId dependency

  // --- Symptom Management ---
  const toggleSymptom = (symptom) => {
    setSelectedSymptoms(prev =>
      prev.includes(symptom)
        ? prev.filter(s => s !== symptom)
        : [...prev, symptom]
    );
  };

  const clearSymptoms = () => setSelectedSymptoms([]);

  const filteredSymptoms = useMemo(() => {
    let symptoms = searchQuery 
      ? SYMPTOM_CATEGORIES.flatMap(cat => ALL_SYMPTOMS_CATEGORIZED[cat])
      : ALL_SYMPTOMS_CATEGORIZED[activeCategory] || [];

    const lowerCaseQuery = searchQuery.toLowerCase();

    return symptoms
      .filter(s => s.toLowerCase().includes(lowerCaseQuery))
      .sort((a, b) => a.localeCompare(b));
  }, [activeCategory, searchQuery]);

  const isEmergency = predictionResult?.emergency_flag || selectedSymptoms.some(s => s.toLowerCase().includes('chest pain') || s.toLowerCase().includes('difficulty breathing'));

  // --- UI Components ---
  return (
    // This container fills the page and organizes content vertically
    <div id="prediction-page" className="h-full flex flex-col p-4 sm:p-8">
      
      {/* SECTION 1: Header */}
      <div 
        className="flex-shrink-0 opacity-0"
        style={{ animation: 'fadeIn 0.5s 0.1s ease-out forwards' }}
      >
        <h2 className="text-4xl font-extrabold text-blue-800 mb-2">Symptom Assessment</h2>
        <p className="text-gray-500 mb-4">Select symptoms to get an initial, non-diagnostic AI assessment.</p>
      </div>

      {/* SECTION 2: Profile (Compact) */}
      <div 
        className="flex-shrink-0 p-4 bg-white/80 backdrop-blur-lg shadow-lg rounded-2xl border border-gray-200/50 mb-4 opacity-0"
        style={{ animation: 'fadeInUp 0.5s 0.2s ease-out forwards' }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-600">Age:</span>
            <input
              type="number"
              value={age}
              onChange={(e) => setAge(Math.max(1, parseInt(e.target.value) || 1))}
              min="1"
              className="mt-1 w-full p-2 border border-gray-300 rounded-xl focus:ring-blue-500 focus:border-blue-500"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-600">Gender:</span>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="mt-1 w-full p-2 border border-gray-300 rounded-xl focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <label className="block sm:col-span-1">
             <span className="text-sm font-medium text-gray-600">Search Symptoms:</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="e.g., pain, fever..."
              className="mt-1 w-full p-2 border border-gray-300 rounded-xl focus:ring-blue-500 focus:border-blue-500"
            />
          </label>
        </div>
      </div>

      {/* SECTION 3: Main Content (Grows and scrolls internally) */}
      <div 
        className="flex-grow flex flex-col lg:flex-row gap-4 opacity-0" // REMOVED min-h-[400px]
        style={{ animation: 'fadeInUp 0.5s 0.3s ease-out forwards' }}
      >
        
        {/* Left Column: Symptom Selection */}
        <div className="lg:w-1/2 flex flex-col bg-white/80 backdrop-blur-lg shadow-lg rounded-2xl border border-gray-200/50 p-4">
          <h3 className="text-xl font-semibold text-blue-800 mb-3 flex-shrink-0">Select Symptoms</h3>
          
          <div className="flex space-x-2 overflow-x-auto pb-2 border-b border-gray-200 flex-shrink-0">
            {SYMPTOM_CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => { setActiveCategory(cat); setSearchQuery(''); }}
                className={`px-4 py-2 rounded-full text-sm font-medium transition duration-150 whitespace-nowrap ${
                  activeCategory === cat && !searchQuery
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-blue-100'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* This grid is now the internally scrolling part */}
          <div className="flex-grow overflow-y-auto pr-2 pt-3 grid grid-cols-2 md:grid-cols-3 gap-3">
            {filteredSymptoms.length > 0 ? filteredSymptoms.map(symptom => {
              const isSelected = selectedSymptoms.includes(symptom);
              return (
                <button
                  key={symptom}
                  onClick={() => toggleSymptom(symptom)}
                  className={`p-3 text-sm h-fit rounded-xl text-left shadow-sm transform transition-all duration-200 ${
                    isSelected
                      ? 'bg-green-500 text-white font-semibold ring-2 ring-green-400 hover:scale-105'
                      : 'bg-gray-50/80 text-gray-700 hover:bg-blue-50 border border-gray-200/50 hover:scale-105'
                  }`}
                >
                  {symptom}
                </button>
              );
            }) : (
              <p className="text-gray-500 italic p-4 col-span-full text-center">No symptoms match your search.</p>
            )}
          </div>
        </div>

        {/* Right Column: Selected & History */}
        <div className="lg:w-1/2 flex flex-col bg-white/80 backdrop-blur-lg shadow-lg rounded-2xl border border-gray-200/50 p-4">
          {/* Selected Symptoms */}
          <div className="flex-shrink-0">
            <h3 className="text-xl font-semibold text-blue-800 mb-3">Selected ({selectedSymptoms.length})</h3>
            <div className="flex flex-wrap gap-2 min-h-[6rem] max-h-[150px] overflow-y-auto border border-dashed border-gray-300 rounded-lg p-3">
              {selectedSymptoms.length === 0 ? (
                <p className="text-gray-400 italic m-auto">Start selecting symptoms from the left...</p>
              ) : (
                selectedSymptoms.map(symptom => (
                  <div key={symptom} className="flex h-fit items-center bg-blue-100 text-blue-800 text-xs font-medium px-3 py-1 rounded-full shadow-sm transform transition-all duration-200 hover:scale-105">
                    {symptom}
                    <button onClick={() => toggleSymptom(symptom)} className="ml-2 text-blue-600 hover:text-red-500 transition">
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
          
          {/* Action Buttons */}
          <div className="flex-shrink-0 flex justify-end space-x-3 mt-4">
              <button
                onClick={clearSymptoms}
                disabled={selectedSymptoms.length === 0 || isLoading}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-200 hover:bg-gray-300 rounded-xl transition-all duration-150 disabled:opacity-50 transform hover:scale-105"
              >
                Clear All
              </button>
              <button
                onClick={handlePrediction}
                disabled={selectedSymptoms.length === 0 || isLoading || !authReady}
                className="px-6 py-3 text-white font-bold bg-blue-600 hover:bg-blue-700 rounded-xl transition-all duration-150 shadow-md disabled:opacity-50 flex items-center justify-center transform hover:scale-105"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Analyzing...
                  </>
                ) : (
                  'Get AI Prediction'
                )}
              </button>
            </div>
        </div>
      </div>
      
      {/* SECTION 4: Actions (Fixed at bottom of viewport content) -> THIS IS MOVED */}
      {/* --- This section was moved up --- */}


      {/* SECTION 5: Results (This part makes the page scrollable, as requested) */}
      <div id="prediction-results" className="mt-6">
        {/* Skeleton Loaders */}
        {isLoading && (
          <div className="space-y-4 w-full"> {/* MODIFIED: Removed max-w-2xl mx-auto */ }
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}
        
        {/* Emergency Warning */}
        {isEmergency && !isLoading && (
          <div className="bg-red-50 border border-red-200 p-4 rounded-xl mb-4 flex items-start text-red-800 w-full"> {/* MODIFIED: Removed max-w-2xl mx-auto */ }
            <Icon name="alertTriangle" size={24} className="mt-1 flex-shrink-0" color="#ef4444" />
            <div className="ml-3">
              <h4 className="font-bold text-lg">EMERGENCY WARNING!</h4>
              <p className="text-sm">Based on one or more selected symptoms, **seek professional medical help immediately.** This AI tool cannot provide life-saving assistance.</p>
            </div>
          </div>
        )}
        
        {/* Results */}
        {predictionResult && !isLoading && !predictionResult.error && (
          <div className="space-y-4 w-full"> {/* MODIFIED: Removed max-w-2xl mx-auto */ }
             <h3 className="text-2xl font-bold text-blue-800 mb-4">AI Assessment</h3>
            {predictionResult.predictions.map((p, index) => {
              const confidencePercent = Math.round(p.confidence * 100);
              let barColor = 'bg-red-400';
              if (confidencePercent > 70) barColor = 'bg-green-500';
              else if (confidencePercent > 40) barColor = 'bg-yellow-500';

              return (
                <div key={index} className="p-4 rounded-xl border shadow-sm" style={{borderColor: '#bbf7d0', backgroundColor: '#f0fdf4'}}>
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-bold text-lg text-green-700">{p.disease}</h4>
                    <span className="text-sm font-semibold text-gray-700">
                      {confidencePercent}%
                    </span>
                  </div>
                  
                  {/* Confidence Bar */}
                  <div className="w-full bg-gray-200 rounded-full h-2.5 mb-3">
                    <div
                      className={`h-2.5 rounded-full ${barColor} transition-all duration-500`}
                      style={{ width: `${confidencePercent}%` }}
                    ></div>
                  </div>

                  <p className="text-sm text-gray-700">{p.description}</p>
                </div>
              );
            })}
          </div>
        )}
        
        {/* Error Message */}
        {predictionResult?.error && !isLoading && (
          <div className="p-4 bg-red-100 border border-red-400 rounded-xl text-red-800 w-full"> {/* MODIFIED: Removed max-w-2xl mx-auto */ }
            <p className="font-semibold">Error:</p>
            <p className="text-sm">{predictionResult.error}</p>
          </div>
        )}
      </div>

      {/* SECTION 6: Recent History (NEWLY MOVED HERE) */}
      <div 
        className="flex-shrink-0 p-4 bg-white/80 backdrop-blur-lg shadow-lg rounded-2xl border border-gray-200/50 mt-6 w-full opacity-0" /* MODIFIED: Removed max-w-2xl mx-auto */
        style={{ animation: 'fadeInUp 0.5s 0.5s ease-out forwards' }}
      >
        <h3 className="text-xl font-semibold text-blue-800 mb-4 flex items-center">
          <Icon name="history" size={20} className="mr-2 text-blue-500" />
          Recent History
        </h3>
        {authReady ? (
          <>
            <p className="text-gray-500 text-xs mb-3">Last 5 checks (User ID: {userId ? `${userId.substring(0, 8)}...` : 'N/A'}):</p>
            <div className="space-y-3 max-h-[200px] overflow-y-auto pr-2">
              {history.length === 0 ? (
                <p className="text-gray-400 italic text-sm">No recent checks found.</p>
              ) : (
                history.map(item => (
                  <div key={item.id} className="p-3 bg-gray-50/80 rounded-lg border border-gray-200 shadow-sm transition duration-200 hover:shadow-md">
                    <p className="text-xs font-semibold text-gray-800">{new Date(item.timestamp?.seconds * 1000).toLocaleString()}</p>
                    <p className="text-sm text-gray-600 mt-1 truncate">
                      Symptoms: {item.symptoms.join(', ')}
                    </p>
                    <p className="text-xs font-medium text-green-600 mt-1">
                      Top Prediction: {item.result.predictions[0]?.disease || 'N/A'}
                    </p>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="text-center p-4 text-gray-500">
            <p>Authenticating Firebase...</p>
          </div>
        )}
      </div>
    </div>
  );
};


// =================================================================================
// --- MAIN APP COMPONENT (CONTROLS PAGES & FIREBASE) ---
// =================================================================================

const App = () => {
  // Firebase States
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [appId, setAppId] = useState(null); // <-- NEW: State for appId

  // Page Navigation State
  const [currentPage, setCurrentPage] = useState('home'); // default page

  // --- FIREBASE INITIALIZATION AND AUTH ---
  useEffect(() => {
    let isMounted = true;
    
    try {
      // --- MODIFICATION FOR VERCEL ---
      // 1. Read the config from Vercel's Environment Variables
      const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
      const firebaseConfigStr = env.VITE_FIREBASE_CONFIG || '{}';
      
      // 2. We are on a public website, so we MUST sign in anonymously.
      const initialAuthToken = null; 
      // --- END OF MODIFICATION ---

      // Basic check for valid config
      if (firebaseConfigStr === '{}') {
          console.error("Firebase config is missing or empty! Make sure VITE_FIREBASE_CONFIG is set in Vercel.");
          return; // This will cause the app to hang on "Authenticating..."
      }
      
      const firebaseConfig = JSON.parse(firebaseConfigStr);

      if (!firebaseConfig.apiKey) {
        console.error("Firebase config is missing apiKey! Check your VITE_FIREBASE_CONFIG.");
        return; // This will also cause the app to hang.
      }
      
      // --- CRITICAL FIX: Get appId from the config object ---
      const newAppId = firebaseConfig.appId; 
      if (!newAppId) {
        console.error("Your firebaseConfig is missing the 'appId'!");
        return;
      }
      // --- END CRITICAL FIX ---


      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      setLogLevel('debug'); // As requested
      const firebaseAuth = getAuth(app);
      
      if (isMounted) {
        setDb(firestore);
        setAuth(firebaseAuth);
        setAppId(newAppId); // <-- NEW: Set appId state
      }

      const attemptAuth = async () => {
        try {
          if (initialAuthToken) {
            // Removed signInWithCustomToken as it's not used in Vercel deployment setup
            // await signInWithCustomToken(firebaseAuth, initialAuthToken);
          } else {
            await signInAnonymously(firebaseAuth);
          }
        } catch (e) {
          console.error("Auth failed, attempting anonymous sign-in fallback:", e);
          try {
            await signInAnonymously(firebaseAuth);
          } catch (eAnon) {
            console.error("Anonymous sign-in fallback failed:", eAnon);
          }
        }
      };
      
      attemptAuth();
      
      onAuthStateChanged(firebaseAuth, (user) => {
        if (!isMounted) return;
        
        if (user) {
          console.log("Firebase Authentication SUCCESS. User ID:", user.uid);
          setUserId(user.uid);
        } else {
          console.warn("Firebase Authentication FAILED. User is not signed in.");
          setUserId(null);
        }
        // This is the line that removes the "Authenticating..." message.
        setAuthReady(true);
      });
      
    } catch (e) {
      console.error("Firebase Initialization Failed (Overall Catch):", e);
      if (isMounted) setAuthReady(true); // Continue with app functionality if Firebase fails
    }
    
    return () => { isMounted = false; };
  }, []);

  // Page Rendering Logic
  const renderPage = () => {
    // This is where the animation class is applied
    const pageContainerClasses = "h-full w-full"; // Page components handle their own animation now

    switch (currentPage) {
      case 'home':
        return <div className={pageContainerClasses}><HomePage onNavigate={setCurrentPage} /></div>;
      case 'prediction':
        // PredictionPage is the only one that scrolls
        // MODIFIED: Pass appId prop
        return <div className={pageContainerClasses + " overflow-y-auto"}><PredictionPage db={db} auth={auth} userId={userId} authReady={authReady} appId={appId} /></div>;
      case 'docbot':
        // MODIFIED: Pass appId prop
        return <div className={pageContainerClasses}><DocBotPage db={db} auth={auth} userId={userId} authReady={authReady} appId={appId} /></div>;
      case 'hospitals':
        return <div className={pageContainerClasses}><HospitalPage /></div>;
      case 'contact':
        return <div className={pageContainerClasses}><ContactPage /></div>;
      default:
        return <div className={pageContainerClasses}><HomePage onNavigate={setCurrentPage} /></div>;
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-gradient-to-br from-white to-blue-50 font-inter overflow-hidden">
      {/* Global Styles & Animations */}
      <style>{`
        /* Page Fade-in */
        @keyframes pageFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        /* Element Fade-in-Up */
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { transform: translateY(0); opacity: 1; }
        }
        
        /* Element Fade-in */
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        /* Typing dots for chatbot */
        .dot-flashing {
          position: relative;
          width: 5px;
          height: 5px;
          border-radius: 5px;
          background-color: #3b82f6;
          color: #3b82f6;
          animation: dotFlashing 1s infinite linear alternate;
          animation-delay: 0s;
          display: inline-block;
        }
        .dot-flashing::before, .dot-flashing::after {
          content: "";
          display: inline-block;
          position: absolute;
          top: 0;
        }
        .dot-flashing::before {
          left: -8px;
          width: 5px;
          height: 5px;
          border-radius: 5px;
          background-color: #3b82f6;
          color: #3b82f6;
          animation: dotFlashing 1s infinite alternate;
          animation-delay: 0.4s;
        }
        .dot-flashing::after {
          left: 8px;
          width: 5px;
          height: 5px;
          border-radius: 5px;
          background-color: #3b82f6;
          color: #3b82f6;
          animation: dotFlashing 1s infinite alternate;
          animation-delay: 0.8s;
        }
        @keyframes dotFlashing {
          0% { opacity: 0.2; }
          50% { opacity: 1; }
          100% { opacity: 0.2; }
        }
      `}</style>
      
      <NavBar currentPage={currentPage} onNavigate={setCurrentPage} />
      
      {/* Main content area is hidden overflow. Scrolling is handled *inside* renderPage */}
      <main className="flex-grow pt-16 overflow-hidden">
        {renderPage()}
      </main>
      
      <Footer className="flex-shrink-0 z-10" />
    </div>
  );
};


export default App;
