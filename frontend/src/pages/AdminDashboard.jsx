import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API_URL from '../config';
import {
    LayoutDashboard,
    ClipboardList,
    CheckCircle,
    Clock,
    AlertCircle,
    LogOut,
    Search,
    RefreshCw,
    ExternalLink,
    User
} from 'lucide-react';

const AdminDashboard = () => {
    const [complaints, setComplaints] = useState([]);
    const [users, setUsers] = useState([]); // All users for admin management
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('All');
    const [filterCategory, setFilterCategory] = useState('All');
    const [currentUser, setCurrentUser] = useState(null);
    const [activeTab, setActiveTab] = useState('tickets'); // 'tickets' or 'users'
    const navigate = useNavigate();

    useEffect(() => {
        const token = localStorage.getItem('token');
        const userStr = localStorage.getItem('user');
        if (!token || !userStr) {
            navigate('/login');
            return;
        }
        const user = JSON.parse(userStr);
        setCurrentUser(user);
        fetchData(user);
    }, []);

    const fetchData = async (user) => {
        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const headers = { 'Authorization': `Bearer ${token}` };

            const res = await fetch(`${API_URL}/api/complaints`, { headers });
            if (res.ok) {
                let data = await res.json();
                if (user.role === 'technician') {
                    data = data.filter(ticket => ticket.assignedTechnician === user.username);
                }
                setComplaints(data.reverse());
            }

            const userRes = await fetch(`${API_URL}/api/auth/users`, { headers });
            if (userRes.ok) {
                const userData = await userRes.json();
                setUsers(userData);
            }

        } catch (err) {
            console.error('Error fetching data:', err);
        } finally {
            setLoading(false);
        }
    };

    // Admin can reset any user's password
    const handleAdminResetPassword = async (userId) => {
        const newPassword = window.prompt('Enter new password for this user:');
        if (!newPassword) return;
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/api/auth/admin-reset-password/${userId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ newPassword })
            });
            if (res.ok) {
                alert('Password reset successfully');
            } else {
                const data = await res.json();
                alert(`Error: ${data.message}`);
            }
        } catch (err) {
            console.error('Error resetting password:', err);
        }
    };

    const handleApproveUser = async (userId) => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/api/auth/approve/${userId}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                setUsers(prev => prev.map(u => u._id === userId ? { ...u, isApproved: true } : u));
            }
        } catch (err) {
            console.error('Error approving user:', err);
        }
    };

    const handleUpdateStatus = async (id, newStatus) => {
        updateComplaint(id, { status: newStatus });
    };

    const handleAssignTechnician = async (id, technicianUsername) => {
        const tech = users.find(u => u.username === technicianUsername);
        updateComplaint(id, {
            assignedTechnician: technicianUsername,
            assignedTechnicianPhone: tech?.phone || tech?.username || ''
        });
    };

    const updateComplaint = async (id, updates) => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/api/complaints/${id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(updates)
            });
            if (res.ok) {
                setComplaints(prev => prev.map(c => c._id === id ? { ...c, ...updates } : c));
            }
        } catch (err) {
            console.error('Error updating:', err);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/login');
    };

    const filteredComplaints = complaints.filter(c => {
        const matchesSearch = (c.complaintId || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (c.customerName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (c.phone || '').includes(searchTerm);
        const matchesStatus = filterStatus === 'All' || c.status === filterStatus;
        const matchesCategory = filterCategory === 'All' || c.issueType === filterCategory;
        return matchesSearch && matchesStatus && matchesCategory;
    });


    const stats = {
        total: complaints.length,
        pending: complaints.filter(c => c.status === 'Pending').length,
        inProgress: complaints.filter(c => c.status === 'In Progress').length,
        resolved: complaints.filter(c => c.status === 'Resolved').length
    };

    const categories = ['All', ...new Set(complaints.map(c => c.issueType))];
    const canAssign = currentUser?.role === 'admin' || currentUser?.role === 'engineer';
    const professionals = users.filter(u => u.role === 'technician' || u.role === 'engineer' || u.role === 'organisation');

    return (
        <div className="min-h-screen bg-gray-50 flex">
            {/* Sidebar */}
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
                        onClick={() => setActiveTab('tickets')}
                        className={`w-full flex items-center gap-3 px-6 py-3 transition-colors ${activeTab === 'tickets' ? 'bg-blue-800 border-l-4 border-yellow-500' : 'hover:bg-blue-800 text-blue-200'}`}
                    >
                        <ClipboardList className="h-5 w-5" />
                        Tickets
                    </button>
                    {currentUser?.role === 'admin' && (
                        <button
                            onClick={() => setActiveTab('users')}
                            className={`w-full flex items-center gap-3 px-6 py-3 mb-4 transition-colors ${activeTab === 'users' ? 'bg-blue-800 border-l-4 border-yellow-500' : 'hover:bg-blue-800 text-blue-200'}`}
                        >
                            <User className="h-5 w-5" />
                            User Management
                        </button>
                    )}
                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-6 py-3 hover:bg-blue-800 text-blue-200 mt-10"
                    >
                        <LogOut className="h-5 w-5" />
                        Logout
                    </button>
                </nav>
            </div>

            {/* Main Content */}
            <div className="flex-grow flex flex-col h-screen overflow-hidden">
                {/* Header */}
                <header className="bg-white border-b border-gray-200 p-4 flex justify-between items-center shadow-sm flex-shrink-0">
                    <h2 className="text-lg font-semibold text-gray-800">
                        {activeTab === 'users' ? 'Partner Approvals' : (currentUser?.role === 'technician' ? 'My Assigned Tickets' : 'System Overview')}
                    </h2>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-blue-900 bg-blue-50 px-3 py-1 rounded-full">
                            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                            {currentUser?.username}
                        </div>
                        <button
                            onClick={() => fetchData(currentUser)}
                            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                        >
                            <RefreshCw className={`h-5 w-5 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </header>

                <div className="p-6 overflow-y-auto">
                    {activeTab === 'tickets' ? (
                        <>
                            {/* Stats */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                                    <p className="text-gray-500 text-sm font-medium">Total Tickets</p>
                                    <h3 className="text-2xl font-bold mt-1">{stats.total}</h3>
                                </div>
                                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100"><h3 className="text-2xl font-bold mt-1 text-yellow-600 text-center">{stats.pending}</h3><p className="text-gray-500 text-xs text-center">Pending</p></div>
                                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100"><h3 className="text-2xl font-bold mt-1 text-blue-600 text-center">{stats.inProgress}</h3><p className="text-gray-500 text-xs text-center">In Progress</p></div>
                                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100"><h3 className="text-2xl font-bold mt-1 text-green-600 text-center">{stats.resolved}</h3><p className="text-gray-500 text-xs text-center">Resolved</p></div>
                            </div>

                            {/* Ticket List */}
                            <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                                <div className="p-4 border-b flex flex-col md:flex-row gap-4 justify-between bg-gray-50/50">
                                    <div className="relative flex-grow max-w-md">
                                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                                        <input
                                            type="text"
                                            placeholder="Search tickets..."
                                            className="pl-10 pr-4 py-2 border rounded-md w-full text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                        />
                                    </div>
                                    <select
                                        className="border rounded px-3 py-2 text-sm"
                                        value={filterCategory}
                                        onChange={(e) => setFilterCategory(e.target.value)}
                                    >
                                        {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                    </select>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left whitespace-nowrap">
                                        <thead className="bg-gray-50 text-xs font-bold text-gray-500 uppercase">
                                            <tr>
                                                <th className="px-6 py-4">Ticket ID</th>
                                                <th className="px-6 py-4">Customer</th>
                                                <th className="px-6 py-4">Status</th>
                                                {canAssign && <th className="px-6 py-4">Assigned To</th>}
                                                <th className="px-6 py-4 text-center">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y text-sm">
                                            {filteredComplaints.length === 0 ? (
                                                <tr><td colSpan="5" className="p-10 text-center text-gray-400">No tickets found</td></tr>
                                            ) : filteredComplaints.map(c => (
                                                <tr key={c._id} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-6 py-4 font-mono font-bold text-blue-600">
                                                        <button
                                                            onClick={() => navigate(`/admin/complaint-details?id=${c.complaintId}`)}
                                                            className="hover:underline flex items-center gap-1"
                                                        >
                                                            {c.complaintId}
                                                            <ExternalLink className="h-3 w-3" />
                                                        </button>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="font-medium">{c.customerName}</div>
                                                        <div className="text-xs text-gray-500">{c.city}</div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <select
                                                            className="border rounded text-xs p-1 outline-none focus:ring-1 focus:ring-blue-500"
                                                            value={c.status}
                                                            onChange={(e) => handleUpdateStatus(c._id, e.target.value)}
                                                        >
                                                            <option>Pending</option>
                                                            <option>In Progress</option>
                                                            <option>Resolved</option>
                                                            <option>Scheduled</option>
                                                        </select>
                                                    </td>
                                                    {canAssign && (
                                                        <td className="px-6 py-4">
                                                            <select
                                                                className="border rounded text-xs p-1 w-full max-w-[150px] outline-none focus:ring-1 focus:ring-blue-500"
                                                                value={c.assignedTechnician || ''}
                                                                onChange={(e) => handleAssignTechnician(c._id, e.target.value)}
                                                            >
                                                                <option value="">Unassigned</option>
                                                                {professionals.map(p => (
                                                                    <option key={p.username} value={p.username}>{p.username} ({p.role})</option>
                                                                ))}
                                                            </select>
                                                        </td>
                                                    )}
                                                    <td className="px-6 py-4 text-center">
                                                        <button
                                                            onClick={() => navigate(`/admin/complaint-details?id=${c.complaintId}`)}
                                                            className="text-gray-400 hover:text-blue-600 transition-colors p-1 rounded hover:bg-blue-50"
                                                            title="View Details"
                                                        >
                                                            <ExternalLink className="h-4 w-4" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    ) : (
                        /* User Management Tab */
                        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                            <table className="w-full text-left whitespace-nowrap">
                                <thead className="bg-gray-50 text-xs font-bold text-gray-500 uppercase">
                                    <tr>
                                        <th className="px-6 py-4">User ID / Username</th>
                                        <th className="px-6 py-4">Role</th>
                                        <th className="px-6 py-4">City / Phone</th>
                                        <th className="px-6 py-4">Status</th>
                                        <th className="px-6 py-4 text-center">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y text-sm">
                                    {users.filter(u => u.role !== 'admin').length === 0 ? (
                                        <tr><td colSpan="5" className="p-10 text-center text-gray-400">No partner users found</td></tr>
                                    ) : users.filter(u => u.role !== 'admin').map(u => (
                                        <tr key={u._id} className="hover:bg-gray-50">
                                            <td className="px-6 py-4 font-medium text-blue-900">{u.username}</td>
                                            <td className="px-6 py-4 capitalize">{u.role}</td>
                                            <td className="px-6 py-4 text-xs">
                                                <div>{u.city || 'N/A'}</div>
                                                <div className="text-gray-500">{u.phone || 'No phone'}</div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${u.isApproved ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700 animate-pulse'}`}>
                                                    {u.isApproved ? 'Approved' : 'Pending'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                {!u.isApproved && (
                                                    <button
                                                        onClick={() => handleApproveUser(u._id)}
                                                        className="bg-green-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-green-700"
                                                    >
                                                        Approve
                                                    </button>
                                                )}
                                                {currentUser?.role === 'admin' && (
                                                    <button
                                                        onClick={() => handleAdminResetPassword(u._id)}
                                                        className="bg-red-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-red-700 ml-2"
                                                    >
                                                        Reset PW
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;
