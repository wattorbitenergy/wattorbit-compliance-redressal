import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import API_URL from '../config';

const ForgotPassword = () => {
    const [username, setUsername] = useState('');
    const [status, setStatus] = useState({ type: '', message: '' });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setStatus({ type: 'info', message: 'Sending request...' });

        try {
            const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });
            const data = await res.json();

            if (res.ok) {
                setStatus({ type: 'success', message: data.message });
            } else {
                setStatus({ type: 'error', message: data.message });
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Failed to send request. Try again.' });
        }
    };

    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center">
            <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
                <h2 className="text-2xl font-bold mb-6 text-center text-blue-900">Forgot Password</h2>

                {status.message && (
                    <div className={`p-3 rounded mb-4 text-sm ${status.type === 'success' ? 'bg-green-100 text-green-700' :
                            status.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                        {status.message}
                    </div>
                )}

                <p className="text-sm text-gray-600 mb-6 text-center">
                    Enter your User ID (Email or Phone) and we'll send you a link to reset your password.
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">User ID</label>
                        <input
                            type="text"
                            required
                            placeholder="Email or Phone"
                            className="w-full border border-gray-300 p-2 rounded focus:border-blue-500 outline-none"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                    </div>

                    <button
                        type="submit"
                        className="w-full bg-blue-600 text-white font-bold py-2 rounded hover:bg-blue-700 transition"
                    >
                        Send Reset Link
                    </button>

                    <div className="text-center mt-4">
                        <Link to="/login" className="text-sm text-blue-500 hover:underline">
                            Back to Login
                        </Link>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ForgotPassword;
