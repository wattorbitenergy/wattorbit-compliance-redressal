import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import API_URL from '../config';

const ResetPassword = () => {
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [status, setStatus] = useState({ type: '', message: '' });
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const token = searchParams.get('token');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            setStatus({ type: 'error', message: 'Passwords do not match' });
            return;
        }

        setStatus({ type: 'info', message: 'Resetting password...' });

        try {
            const res = await fetch(`${API_URL}/api/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, newPassword })
            });
            const data = await res.json();

            if (res.ok) {
                setStatus({ type: 'success', message: 'Password reset successful! Redirecting to login...' });
                setTimeout(() => navigate('/login'), 3000);
            } else {
                setStatus({ type: 'error', message: data.message });
            }
        } catch (err) {
            setStatus({ type: 'error', message: 'Failed to reset password. Try again.' });
        }
    };

    if (!token) {
        return (
            <div className="min-h-screen bg-gray-100 flex items-center justify-center">
                <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md text-center">
                    <h2 className="text-2xl font-bold mb-4 text-red-600">Invalid Link</h2>
                    <p className="text-gray-600 mb-6">This password reset link is invalid or missing a token.</p>
                    <Link to="/login" className="text-blue-500 hover:underline">Back to Login</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center">
            <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
                <h2 className="text-2xl font-bold mb-6 text-center text-blue-900">Reset Password</h2>

                {status.message && (
                    <div className={`p-3 rounded mb-4 text-sm ${status.type === 'success' ? 'bg-green-100 text-green-700' :
                        status.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                        {status.message}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">New Password</label>
                        <input
                            type="password"
                            required
                            placeholder="Min 6 characters"
                            className="w-full border border-gray-300 p-2 rounded focus:border-blue-500 outline-none"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">Confirm New Password</label>
                        <input
                            type="password"
                            required
                            placeholder="Repeat new password"
                            className="w-full border border-gray-300 p-2 rounded focus:border-blue-500 outline-none"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                        />
                    </div>

                    <button
                        type="submit"
                        className="w-full bg-blue-600 text-white font-bold py-2 rounded hover:bg-blue-700 transition"
                    >
                        Reset Password
                    </button>
                </form>
            </div>
        </div>
    );
};

export default ResetPassword;
