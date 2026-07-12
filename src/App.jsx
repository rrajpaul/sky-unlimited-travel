import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import HomePage from '@/pages/HomePage';
import AdminPage from '@/components/Admin';
import AdminGiveawayEntries from '@/components/AdminGiveawayEntries';

function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/giveaway" element={<AdminGiveawayEntries />} />
      </Routes>
      <Toaster />
    </>
  );
}

export default App;