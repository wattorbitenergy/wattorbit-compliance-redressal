import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import API_URL from '../config';

const Register = () => {
    const [formData, setFormData] = useState({
        username: '', // This will be their email or phone for login
        password: '',
        role: 'technician',
        city: '',
        phone: '',
        email: ''
    });
    const [status, setStatus] = useState({ type: '', message: '' });
    const navigate = useNavigate();

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setStatus({ type: 'info', message: 'Registering...' });

        // Use email or phone as the 'username' depending on what they provided as primary
        // For simplicity, we can default username to email, or force them to pick one.
        // Let's assume the 'username' field in the form acts as the User ID (Email/Phone)

        try {
            const res = await fetch(`${API_URL}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            const data = await res.json();

            if (res.ok) {
                setStatus({ type: 'success', message: data.message });
                setTimeout(() => navigate('/login'), 3000);
            } else {
                setStatus({ type: 'error', message: data.message });
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Registration failed. Try again.' });
        }
    };

    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center py-10">
            <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
                <h2 className="text-2xl font-bold mb-6 text-center text-blue-900">Partner Registration</h2>

                {status.message && (
                    <div className={`p-3 rounded mb-4 text-sm ${status.type === 'success' ? 'bg-green-100 text-green-700' :
                        status.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                        {status.message}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Register As engineer,technician /organisation</label>
                        <select
                            name="role"
                            value={formData.role}
                            onChange={handleChange}
                            className="w-full border border-gray-300 p-2 rounded focus:border-blue-500 outline-none"
                        >
                            <option value="technician">Technician</option>
                            <option value="engineer">Engineer</option>
                            <option value="organisation">Organisation</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">User ID (Phone or Email)</label>
                        <input
                            type="text"
                            name="username"
                            required
                            placeholder="Enter your phone or email to login"
                            className="w-full border border-gray-300 p-2 rounded focus:border-blue-500 outline-none"
                            value={formData.username}
                            onChange={handleChange}
                        />
                        <p className="text-xs text-gray-400 mt-1">This will be your login username.</p>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Phone Number</label>
                        <input
                            type="text"
                            name="phone"
                            required
                            placeholder="Primary Contact Number"
                            className="w-full border border-gray-300 p-2 rounded focus:border-blue-500 outline-none"
                            value={formData.phone}
                            onChange={handleChange}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">City</label>
                        <input
                            type="text"
                            name="city"
                            required
                            placeholder="Operating City"
                            className="w-full border border-gray-300 p-2 rounded focus:border-blue-500 outline-none"
                            value={formData.city}
                            onChange={handleChange}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Password</label>
                        <input
                            type="password"
                            name="password"
                            required
                            className="w-full border border-gray-300 p-2 rounded focus:border-blue-500 outline-none"
                            value={formData.password}
                            onChange={handleChange}
                        />
                    </div>

                    <button
                        type="submit"
                        className="w-full bg-blue-600 text-white font-bold py-2 rounded hover:bg-blue-700 transition"
                    >
                        Register
                    </button>

                    <div className="text-center mt-4">
                        <Link to="/login" className="text-sm text-blue-500 hover:underline">
                            Already have an account? Login here
                        </Link>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default Register;
