import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X, Zap } from 'lucide-react';

const Header = () => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <header className="bg-white shadow-md sticky top-0 z-50">
            <div className="container mx-auto px-4 py-3 flex justify-between items-center">
                {/* Logo */}
                <Link to="https://wattorbit.in/" className="flex items-center gap-2">
                    <Zap className="h-8 w-8 text-yellow-500 fill-current" />
                    <span className="text-2xl font-bold text-blue-900">WattOrbit</span>
                </Link>

                {/* Desktop Nav */}
                <nav className="hidden md:flex items-center gap-6">
                    <Link to="/" className="text-gray-700 hover:text-blue-600 font-medium">Home</Link>
                    <Link to="/complaint" className="text-gray-700 hover:text-blue-600 font-medium">Register Complaint</Link>
                    <Link to="/track" className="text-gray-700 hover:text-blue-600 font-medium">Track Status</Link>
                    <Link to="/support" className="text-gray-700 hover:text-blue-600 font-medium">Support</Link>
                    <Link to="/admin" className="text-gray-700 hover:text-blue-600 font-medium">Admin</Link>
                    <Link to="/login" className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition font-bold">
                        Register/Sign In
                    </Link>
                </nav>

                {/* Mobile Menu Button */}
                <button onClick={() => setIsOpen(!isOpen)} className="md:hidden text-gray-700">
                    {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
                </button>
            </div>

            {/* Mobile Nav */}
            {isOpen && (
                <div className="md:hidden bg-white border-t border-gray-100">
                    <div className="flex flex-col p-4 space-y-3">
                        <Link to="/" className="text-gray-700 hover:text-blue-600" onClick={() => setIsOpen(false)}>Home</Link>
                        <Link to="/complaint" className="text-gray-700 hover:text-blue-600" onClick={() => setIsOpen(false)}>Register Complaint</Link>
                        <Link to="/track" className="text-gray-700 hover:text-blue-600" onClick={() => setIsOpen(false)}>Track Status</Link>
                        <Link to="/support" className="text-gray-700 hover:text-blue-600" onClick={() => setIsOpen(false)}>Support</Link>
                        <Link to="/admin" className="text-gray-700 hover:text-blue-600" onClick={() => setIsOpen(false)}>Admin</Link>
                        <Link to="/login" className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 w-full text-center font-bold" onClick={() => setIsOpen(false)}>
                            Register/Sign In
                        </Link>
                    </div>
                </div>
            )}
        </header>
    );
};

export default Header;
