import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import "./index.css";
import { ToastProvider } from "./components/ui";
import { LangProvider } from "./lib/i18n";
import { PublicLayout, StaffLayout } from "./components/layouts";
import Donate from "./pages/public/Donate";
import Apply from "./pages/public/Apply";
import Track from "./pages/public/Track";
import Transparency from "./pages/public/Transparency";
import Login from "./pages/staff/Login";
import Dashboard from "./pages/staff/Dashboard";
import Applications from "./pages/staff/Applications";
import Agent from "./pages/staff/Agent";
import Donations from "./pages/staff/Donations";
import Audit from "./pages/staff/Audit";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <ToastProvider>
       <LangProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<PublicLayout />}>
              <Route path="/" element={<Donate />} />
              <Route path="/apply" element={<Apply />} />
              <Route path="/track" element={<Track />} />
              <Route path="/transparency" element={<Transparency />} />
            </Route>
            <Route path="/staff/login" element={<Login />} />
            <Route path="/staff" element={<StaffLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="applications" element={<Applications />} />
              <Route path="agent" element={<Agent />} />
              <Route path="donations" element={<Donations />} />
              <Route path="audit" element={<Audit />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
       </LangProvider>
      </ToastProvider>
    </MotionConfig>
  </React.StrictMode>
);
