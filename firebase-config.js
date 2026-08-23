import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBCMPxNB58yeF5zUxQmSlL_MjSGN8VR7YY",
  authDomain: "momentlog-afcbf.firebaseapp.com",
  databaseURL: "https://momentlog-afcbf-default-rtdb.firebaseio.com",
  projectId: "momentlog-afcbf",
  storageBucket: "momentlog-afcbf.firebasestorage.app",
  messagingSenderId: "585186639693",
  appId: "1:585186639693:web:9161128d29688044950104",
  measurementId: "G-9QP570QV5X"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);

export { app, auth, database };
