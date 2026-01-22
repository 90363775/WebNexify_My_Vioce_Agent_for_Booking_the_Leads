import React from 'react';

const Header: React.FC = () => {
  return (
    <div className="w-full border-b border-gray-700 bg-brand-dark/95 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-brand-500/20">
            W
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">WebnexifyStudio</h1>
            <p className="text-xs text-gray-400">Enterprise AI & Dev Solutions</p>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-sm">
          <span className="px-3 py-1 rounded-full bg-green-900/30 text-green-400 border border-green-800/50 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            System Operational
          </span>
        </div>
      </div>
    </div>
  );
};

export default Header;
