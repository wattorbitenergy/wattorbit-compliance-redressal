import React, { useState } from 'react';
import API_URL from '../config';
import { Search, Loader, AlertCircle, CheckCircle, Clock } from 'lucide-react';

const TrackStatus = () => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!query.trim()) return;

        setLoading(true);
        setError(null);
        setResults(null);

        try {
            const response = await fetch(`${API_URL}/api/complaints/track?query=${query}`);
            const data = await response.json();

            if (response.ok) {
                if (data.length === 0) {
                    setError('No complaints found with this ID or Phone Number.');
                } else {
                    setResults(data);
                }
            } else {
                setError(data.message || 'Failed to fetch status');
            }
        } catch (err) {
            setError('Network error. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'Resolved': return 'text-green-600 bg-green-100';
            case 'In Progress': return 'text-yellow-600 bg-yellow-100';
            case 'Assigned': return 'text-purple-600 bg-purple-100';
            case 'Pending': return 'text-red-600 bg-red-100';
            default: return 'text-blue-600 bg-blue-100';
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'Resolved': return <CheckCircle className="h-5 w-5" />;
            case 'In Progress': return <Clock className="h-5 w-5" />;
            case 'Assigned': return <Clock className="h-5 w-5" />;
            case 'Pending': return <AlertCircle className="h-5 w-5" />;
            default: return <AlertCircle className="h-5 w-5" />;
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 py-12">
            <div className="container mx-auto px-4 max-w-lg">
                <h1 className="text-3xl font-bold text-center mb-8 text-blue-900">Track Complaint Status</h1>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 mb-8">
                    <form onSubmit={handleSearch} className="flex gap-2">
                        <input
                            type="text"
                            placeholder="Enter Complaint ID or Phone Number"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="flex-grow border border-gray-300 rounded-md px-4 py-3 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        />
                        <button
                            type="submit"
                            disabled={loading}
                            className="bg-blue-600 text-white px-6 py-3 rounded-md font-bold hover:bg-blue-700 transition disabled:bg-blue-300"
                        >
                            {loading ? <Loader className="animate-spin" /> : <Search />}
                        </button>
                    </form>
                </div>

                {error && (
                    <div className="bg-red-100 text-red-700 p-4 rounded-lg mb-6 text-center">
                        {error}
                    </div>
                )}

                {results && (
                    <div className="space-y-4">
                        {results.map((complaint) => (
                            <div key={complaint._id} className="bg-white p-6 rounded-lg shadow-md border-l-4 border-blue-500">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <h3 className="font-bold text-lg text-gray-800">{complaint.issueType}</h3>
                                        <p className="text-xs text-gray-500">ID: {complaint.complaintId || complaint._id}</p>
                                    </div>
                                    <span className={`px-3 py-1 rounded-full text-sm font-medium flex items-center gap-1 ${getStatusColor(complaint.status)}`}>
                                        {getStatusIcon(complaint.status)}
                                        {complaint.status}
                                    </span>
                                </div>

                                <div className="space-y-2 text-sm text-gray-600">
                                    <p><span className="font-semibold">Description:</span> {complaint.description}</p>
                                    <p><span className="font-semibold">Date:</span> {new Date(complaint.createdAt).toLocaleDateString()}</p>

                                    {complaint.status === 'Pending' && complaint.pendingReason && (
                                        <p className="mt-2 text-red-800 bg-red-50 p-2 rounded border border-red-100">
                                            <span className="font-bold">Pending Reason:</span> {complaint.pendingReason}
                                        </p>
                                    )}

                                    {complaint.assignedTechnician && (
                                        <div className="mt-2 text-blue-800 bg-blue-50 p-3 rounded">
                                            <p><span className="font-bold">Assigned Technician:</span> {complaint.assignedTechnician}</p>
                                            {complaint.assignedTechnicianPhone && (
                                                <div className="mt-2 flex items-center justify-between">
                                                    <p className="font-medium text-sm">Phone: {complaint.assignedTechnicianPhone}</p>
                                                    <a
                                                        href={`https://wa.me/91${complaint.assignedTechnicianPhone}?text=Hello, this is regarding my complaint ${complaint.complaintId}.`}
                                                        target="_blank"
                                                        className="bg-green-500 text-white px-3 py-1 rounded text-xs font-bold hover:bg-green-600 transition"
                                                    >
                                                        WhatsApp
                                                    </a>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default TrackStatus;
