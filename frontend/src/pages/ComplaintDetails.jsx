import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import API_URL from '../config';
import {
    LayoutDashboard,
    ClipboardList,
    LogOut,
    RefreshCw,
    ArrowLeft,
    User,
    Phone,
    Mail,
    MapPin,
    AlertCircle,
    Calendar,
    Tag,
    Clock,
    CheckCircle
} from 'lucide-react';

const ComplaintDetails = () => {
    const [complaint, setComplaint] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isUpdating, setIsUpdating] = useState(false);
    const [error, setError] = useState('');
    const [currentUser, setCurrentUser] = useState(null);
    const [newStatus, setNewStatus] = useState('');
    const [remark, setRemark] = useState('');
    const navigate = useNavigate();
    const location = useLocation();

    // Get ID from URL query param /admin/complaint-details?id=...
    const queryParams = new URLSearchParams(location.search);
    const id = queryParams.get('id');

    useEffect(() => {
        const token = localStorage.getItem('token');
        const userStr = localStorage.getItem('user');

        if (!token || !userStr) {
            navigate('/login');
            return;
        }

        const user = JSON.parse(userStr);
        setCurrentUser(user);

        if (!id) {
            setError('No Ticket ID provided');
            setLoading(false);
            return;
        }

        fetchComplaint(id);
    }, [id, navigate]);

    useEffect(() => {
        if (complaint) {
            setNewStatus(complaint.status);
            setRemark(complaint.pendingReason || '');
        }
    }, [complaint]);

    const fetchComplaint = async (complaintId) => {
        setLoading(true);
        setError('');
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/api/complaints/track?query=${complaintId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                const data = await res.json();
                if (data && data.length > 0) {
                    setComplaint(data[0]);
                } else {
                    setError('Ticket not found');
                }
            } else {
                setError('Failed to fetch ticket details');
            }
        } catch (err) {
            console.error('Error fetching complaint:', err);
            setError('Server error while fetching details');
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateStatus = async () => {
        if (!complaint) return;
        setIsUpdating(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/api/complaints/${complaint._id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    status: newStatus,
                    pendingReason: (newStatus === 'Pending' || newStatus === 'Scheduled') ? remark : ''
                })
            });
            if (res.ok) {
                const updated = await res.json();
                setComplaint(updated);
                alert('Status updated successfully');
            } else {
                alert('Failed to update status');
            }
        } catch (err) {
            console.error('Error updating status:', err);
            alert('Error updating status');
        } finally {
            setIsUpdating(false);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/login');
    };

    const getStatusStyle = (status) => {
        switch (status) {
            case 'Resolved': return 'bg-green-100 text-green-700 border-green-200';
            case 'In Progress': return 'bg-blue-100 text-blue-700 border-blue-200';
            case 'Pending': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
            case 'Scheduled': return 'bg-purple-100 text-purple-700 border-purple-200';
            default: return 'bg-gray-100 text-gray-700 border-gray-200';
        }
    };

    const getWhatsAppLink = () => {
        if (!complaint) return '#';
        const cleanPhone = complaint.phone.replace(/\D/g, '');
        const phone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
        const text = encodeURIComponent(`Hello ${complaint.customerName},\nThis is an update regarding your Ticket ${complaint.complaintId} with WattOrbit Energy.\n\nCurrent Status: ${complaint.status}${complaint.pendingReason ? `\nRemark: ${complaint.pendingReason}` : ''}\n\nWe are working to resolve this as soon as possible. Thank you.`);
        return `https://wa.me/${phone}?text=${text}`;
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <RefreshCw className="h-8 w-8 text-blue-600 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 flex">
            {/* Sidebar Replicated from AdminDashboard */}
            <div className="w-64 bg-blue-900 text-white hidden md:block flex-shrink-0">
                <div className="p-6">
                    <h1 className="text-xl font-bold flex items-center gap-2">
                        <LayoutDashboard className="h-6 w-6" />
                        WattOrbit
                    </h1>
                    <p className="text-xs text-blue-300 mt-1 uppercase tracking-wider">{currentUser?.role} Portal</p>
                </div>
                <nav className="mt-6">
                    <button
                        onClick={() => navigate('/admin')}
                        className="w-full flex items-center gap-3 px-6 py-3 text-blue-200 hover:bg-blue-800 transition-colors"
                    >
                        <ClipboardList className="h-5 w-5" />
                        Dashboard
                    </button>
                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-6 py-3 text-blue-200 hover:bg-blue-800 mt-10 transition-colors"
                    >
                        <LogOut className="h-5 w-5" />
                        Logout
                    </button>
                </nav>
            </div>

            {/* Main Content */}
            <div className="flex-grow flex flex-col h-screen overflow-hidden">
                <header className="bg-white border-b border-gray-200 p-4 flex justify-between items-center shadow-sm flex-shrink-0">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate('/admin')}
                            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                        >
                            <ArrowLeft className="h-5 w-5 text-gray-600" />
                        </button>
                        <h2 className="text-lg font-semibold text-gray-800">Complaint Details</h2>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-sm font-medium text-blue-900 bg-blue-50 px-3 py-1 rounded-full">
                            {currentUser?.username}
                        </div>
                    </div>
                </header>

                <div className="p-6 overflow-y-auto">
                    {error ? (
                        <div className="bg-white p-8 rounded-lg shadow-sm border border-red-100 text-center">
                            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-gray-800 mb-2">{error}</h3>
                            <button
                                onClick={() => navigate('/admin')}
                                className="text-blue-600 hover:underline"
                            >
                                Back to Dashboard
                            </button>
                        </div>
                    ) : complaint && (
                        <div className="max-w-4xl mx-auto space-y-6">
                            {/* Header Card */}
                            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                <div>
                                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Ticket ID</div>
                                    <h1 className="text-2xl font-bold text-blue-600 font-mono">{complaint.complaintId}</h1>
                                </div>
                                <div className="flex flex-col items-end">
                                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 text-right">Current Status</div>
                                    <span className={`px-4 py-1.5 rounded-full text-sm font-bold border ${getStatusStyle(complaint.status)}`}>
                                        {complaint.status}
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pb-12">
                                {/* Left Column: Customer Info */}
                                <div className="md:col-span-2 space-y-6">
                                    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                                        <h3 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2 flex items-center gap-2">
                                            <User className="h-5 w-5 text-blue-600" />
                                            Customer Information
                                        </h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="space-y-4">
                                                <div className="flex items-start gap-3">
                                                    <User className="h-4 w-4 text-gray-400 mt-1" />
                                                    <div>
                                                        <p className="text-xs text-gray-500 uppercase font-bold">Name</p>
                                                        <p className="text-gray-900 font-medium">{complaint.customerName}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-start gap-3">
                                                    <Phone className="h-4 w-4 text-gray-400 mt-1" />
                                                    <div>
                                                        <p className="text-xs text-gray-500 uppercase font-bold">Phone</p>
                                                        <p className="text-gray-900 font-medium">{complaint.phone}</p>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="space-y-4">
                                                <div className="flex items-start gap-3">
                                                    <Mail className="h-4 w-4 text-gray-400 mt-1" />
                                                    <div>
                                                        <p className="text-xs text-gray-500 uppercase font-bold">Email</p>
                                                        <p className="text-gray-900 font-medium">{complaint.email || 'N/A'}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-start gap-3">
                                                    <MapPin className="h-4 w-4 text-gray-400 mt-1" />
                                                    <div>
                                                        <p className="text-xs text-gray-500 uppercase font-bold">Location</p>
                                                        <p className="text-gray-900 font-medium">{complaint.city}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-6 p-4 bg-gray-50 rounded border border-gray-100 flex items-start gap-3">
                                            <MapPin className="h-4 w-4 text-gray-400 mt-1" />
                                            <div>
                                                <p className="text-xs text-gray-500 uppercase font-bold">Full Address</p>
                                                <p className="text-gray-700 text-sm whitespace-pre-wrap">{complaint.address}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Issue Card */}
                                    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                                        <h3 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2 flex items-center gap-2">
                                            <AlertCircle className="h-5 w-5 text-blue-600" />
                                            Issue Description
                                        </h3>
                                        <div className="mb-4 flex items-center gap-4">
                                            <div className="bg-blue-50 px-3 py-1 rounded border border-blue-100 flex items-center gap-2">
                                                <Tag className="h-3 w-3 text-blue-600" />
                                                <span className="text-xs font-bold text-blue-800">{complaint.issueType}</span>
                                            </div>
                                            <div className="bg-gray-100 px-3 py-1 rounded border border-gray-200 flex items-center gap-2">
                                                <Clock className="h-3 w-3 text-gray-500" />
                                                <span className="text-xs font-bold text-gray-600">{complaint.type || 'Complaint'}</span>
                                            </div>
                                        </div>
                                        <div className="p-4 bg-yellow-50/50 rounded border border-yellow-100 text-gray-800 leading-relaxed min-h-[100px]">
                                            {complaint.description || 'No description provided.'}
                                        </div>
                                    </div>
                                </div>

                                {/* Right Column: Status & Timeline */}
                                <div className="space-y-6">
                                    {/* Update Status Card */}
                                    <div className="bg-white p-6 rounded-lg shadow-sm border border-blue-100 ring-1 ring-blue-50">
                                        <h3 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2">Update Ticket Status</h3>
                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">New Status</label>
                                                <select
                                                    className="w-full border rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                                    value={newStatus}
                                                    onChange={(e) => setNewStatus(e.target.value)}
                                                >
                                                    <option value="Pending">Pending</option>
                                                    <option value="In Progress">In Progress</option>
                                                    <option value="Scheduled">Scheduled</option>
                                                    <option value="Resolved">Resolved</option>
                                                </select>
                                            </div>

                                            {(newStatus === 'Pending' || newStatus === 'Scheduled') && (
                                                <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                                        {newStatus} Remark
                                                    </label>
                                                    <textarea
                                                        className="w-full border rounded-md p-2 text-sm min-h-[80px] outline-none focus:ring-2 focus:ring-blue-500"
                                                        placeholder={`Enter reason for ${newStatus} status...`}
                                                        value={remark}
                                                        onChange={(e) => setRemark(e.target.value)}
                                                    ></textarea>
                                                </div>
                                            )}

                                            <button
                                                onClick={handleUpdateStatus}
                                                disabled={isUpdating}
                                                className="w-full py-2.5 bg-blue-600 text-white font-bold rounded-md hover:bg-blue-700 transition flex items-center justify-center gap-2 disabled:bg-blue-300 shadow-md"
                                            >
                                                {isUpdating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                                                Update Status
                                            </button>
                                        </div>
                                    </div>

                                    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                                        <h3 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2">Assignment Details</h3>
                                        <div className="space-y-4">
                                            <div>
                                                <p className="text-xs text-gray-500 uppercase font-bold mb-2">Technician</p>
                                                {complaint.assignedTechnician ? (
                                                    <div className="p-3 bg-green-50 rounded border border-green-100">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <CheckCircle className="h-4 w-4 text-green-600" />
                                                            <p className="text-sm font-bold text-gray-900">{complaint.assignedTechnician}</p>
                                                        </div>
                                                        <p className="text-xs text-gray-600 ml-6">{complaint.assignedTechnicianPhone}</p>
                                                    </div>
                                                ) : (
                                                    <div className="p-3 bg-red-50 rounded border border-red-100 flex items-center gap-2">
                                                        <AlertCircle className="h-4 w-4 text-red-500" />
                                                        <p className="text-sm font-medium text-red-700">Currently Unassigned</p>
                                                    </div>
                                                )}
                                            </div>
                                            <div>
                                                <p className="text-xs text-gray-500 uppercase font-bold mb-1">System Timeline</p>
                                                <div className="flex items-center gap-2 text-sm text-gray-900">
                                                    <Calendar className="h-4 w-4 text-gray-400" />
                                                    <span className="text-xs font-medium">Updated: {new Date(complaint.updatedAt).toLocaleString()}</span>
                                                </div>
                                            </div>
                                            {complaint.pendingReason && (
                                                <div className="p-3 bg-yellow-50 rounded border border-yellow-200">
                                                    <p className="text-xs text-yellow-800 uppercase font-bold mb-1">Current Active Remark</p>
                                                    <p className="text-sm text-yellow-900 leading-snug">{complaint.pendingReason}</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Action Shortcuts */}
                                    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                                        <h3 className="text-md font-bold text-gray-800 mb-4">Quick Actions</h3>
                                        <div className="grid grid-cols-1 gap-3">
                                            <a
                                                href={getWhatsAppLink()}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="w-full py-2.5 bg-green-600 text-white text-sm font-bold rounded hover:bg-green-700 transition shadow-sm flex items-center justify-center gap-2"
                                            >
                                                {/* WhatsApp Icon */}
                                                <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                                                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.246 2.248 3.484 5.232 3.483 8.412-.003 6.557-5.338 11.892-11.893 11.892-1.997-.001-3.951-.5-5.688-1.448l-6.308 1.656zm6.29-4.139c1.52.923 3.402 1.486 5.463 1.486 5.564 0 10.088-4.525 10.091-10.091.002-2.701-1.047-5.242-2.952-7.149-1.907-1.906-4.444-2.956-7.143-2.957-5.563 0-10.088 4.524-10.091 10.091 0 2.158.569 4.14 1.644 5.856l-1.071 3.91 4.059-1.064z" />
                                                    <path d="M17.472 14.382c-.301-.149-1.774-.873-2.046-.975-.27-.103-.467-.149-.665.149-.197.297-.767.975-.94 1.171-.173.196-.347.218-.648.071-.301-.148-1.274-.469-2.426-1.493-.896-.798-1.5-1.783-1.677-2.08-.178-.299-.018-.458.13-.606.134-.133.301-.347.451-.52.151-.172.201-.296.301-.497.1-.199.049-.373-.025-.52-.075-.148-.665-1.613-.912-2.204-.241-.579-.481-.5-.665-.51l-.568-.009c-.198 0-.52.074-.792.372-.272.296-1.039 1.015-1.039 2.479 0 1.462 1.065 2.876 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.774-.726 2.022-1.429.247-.699.247-1.299.172-1.427-.074-.128-.271-.202-.572-.351z" />
                                                </svg>
                                                Message on WhatsApp
                                            </a>
                                            <button
                                                onClick={() => fetchData(id)}
                                                className="w-full py-2.5 bg-blue-50 text-blue-600 text-sm font-bold rounded hover:bg-blue-100 transition shadow-sm border border-blue-200 flex items-center justify-center gap-2"
                                            >
                                                <RefreshCw className="h-4 w-4" />
                                                Refresh Data
                                            </button>
                                            <button
                                                onClick={() => window.print()}
                                                className="w-full py-2.5 bg-white text-gray-700 text-sm font-medium rounded hover:bg-gray-50 border border-gray-200 transition"
                                            >
                                                Print Details
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ComplaintDetails;
