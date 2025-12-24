import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import API_URL from '../config';

const Complaint = () => {
    const [searchParams] = useSearchParams();
    const type = searchParams.get('type') === 'service' ? 'Service Request' : 'Complaint';

    const [formData, setFormData] = useState({
        customerName: '',
        phone: '',
        email: '',
        city: '',
        address: '',
        issueType: '',
        description: '',
        type: type
    });

    const [cities, setCities] = useState([]);
    const [status, setStatus] = useState('idle');
    const [submittedId, setSubmittedId] = useState(null);
    const [copyStatus, setCopyStatus] = useState('');

    const complaintTypes = [
        'Solar Setup', 'Inverter Issue', 'Wiring / Safety', 'Billing / Compliance',
        'LED Lights & Fixtures', 'High Mast Tower', 'AC/Geyser', 'Other'
    ];

    const serviceTypes = [
        'AC Installation', 'AC Relocation', 'Geyser Installation',
        'LED TV Installation', 'Board Fixing', 'New Domestic Wiring', 'Other'
    ];

    useEffect(() => {
        setFormData(prev => ({
            ...prev,
            type: type,
            issueType: type === 'Service Request' ? serviceTypes[0] : complaintTypes[0]
        }));
    }, [type]);

    useEffect(() => {
        const fetchCities = async () => {
            try {
                const res = await fetch(`${API_URL}/api/cities`);
                if (!res.ok) throw new Error('Failed to fetch');
                const data = await res.json();
                setCities(data);
            } catch (err) {
                console.log('Error fetching cities, using fallback:', err);
                // Fallback list updated as per request
                setCities([
                    { name: 'Lucknow' }, { name: 'Delhi' }, { name: 'Mumbai' },
                    { name: 'Bangalore' }, { name: 'Hyderabad' }, { name: 'Ghaziabad' },
                    { name: 'Bareilly' }, { name: 'Sitapur' }, { name: 'Lakhimpur' },
                    { name: 'Ayodhya' }, { name: 'Varanasi' }, { name: 'Gonda' },
                    { name: 'Akbarpur' }, { name: 'Ambedkar Nagar' }
                ]);
            }
        };
        fetchCities();
    }, []);

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleCopy = async () => {
        if (submittedId) {
            try {
                await navigator.clipboard.writeText(submittedId);
                setCopyStatus('Copied!');
                setTimeout(() => setCopyStatus(''), 2000);
            } catch (err) {
                console.error('Failed to copy: ', err);
                setCopyStatus('Failed to copy');
            }
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setStatus('submitting');
        setSubmittedId(null);
        setCopyStatus('');
        try {
            const response = await fetch(`${API_URL}/api/complaints`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            const data = await response.json();

            if (response.ok) {
                setStatus('success');
                setSubmittedId(data.complaintId);
                setFormData({
                    customerName: '', phone: '', email: '', city: '', address: '',
                    issueType: type === 'Service Request' ? serviceTypes[0] : complaintTypes[0],
                    description: '',
                    type: type
                });
            } else {
                setStatus('error');
            }
        } catch (error) {
            console.error(error);
            setStatus('error');
        }
    };

    const isService = type === 'Service Request';

    return (
        <div className="min-h-screen bg-gray-50 py-12">
            <div className="container mx-auto px-4 max-w-2xl">
                <h1 className={`text-3xl font-bold text-center mb-8 ${isService ? 'text-green-800' : 'text-blue-900'}`}>
                    {isService ? 'Book a Service' : 'Register a Complaint'}
                </h1>

                <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-100">
                    {status === 'success' && (
                        <div className="bg-green-100 text-green-700 p-4 rounded mb-6">
                            <p className="font-bold">{isService ? 'Service booked' : 'Complaint registered'} successfully!</p>
                            <p className="text-sm mt-1 flex items-center">
                                Your Ticket ID is: <span className="font-mono bg-white px-2 py-0.5 rounded border border-green-200 ml-2">{submittedId}</span>
                                <button
                                    type="button"
                                    onClick={handleCopy}
                                    className="ml-2 px-3 py-1 text-xs bg-green-200 text-green-800 rounded hover:bg-green-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-50"
                                >
                                    {copyStatus || 'Copy'}
                                </button>
                            </p>
                            <p className="text-sm mt-2">Please save this ID to track your status.</p>
                        </div>
                    )}
                    {status === 'error' && (
                        <div className="bg-red-100 text-red-700 p-4 rounded mb-6">
                            Failed to submit. Please try again or contact support directly.
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                                <input
                                    type="text"
                                    name="customerName"
                                    value={formData.customerName}
                                    onChange={handleChange}
                                    required
                                    className="w-full border-gray-300 border rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                                <input
                                    type="tel"
                                    name="phone"
                                    value={formData.phone}
                                    onChange={handleChange}
                                    required
                                    className="w-full border-gray-300 border rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Email (Optional)</label>
                            <input
                                type="email"
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                className="w-full border-gray-300 border rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                                <select
                                    name="city"
                                    value={formData.city}
                                    onChange={handleChange}
                                    required
                                    className="w-full border-gray-300 border rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                                >
                                    <option value="">Select City</option>
                                    {cities.map(city => (
                                        <option key={city._id || city.name} value={city.name}>{city.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    {isService ? 'Service Type' : 'Issue Type'}
                                </label>
                                <select
                                    name="issueType"
                                    value={formData.issueType}
                                    onChange={handleChange}
                                    className="w-full border-gray-300 border rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                                >
                                    {(isService ? serviceTypes : complaintTypes).map(t => (
                                        <option key={t} value={t}>{t}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                            <textarea
                                name="address"
                                value={formData.address}
                                onChange={handleChange}
                                rows="2"
                                required
                                className="w-full border-gray-300 border rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                            ></textarea>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                {isService ? 'Additional Requirements' : 'Description of Issue'}
                            </label>
                            <textarea
                                name="description"
                                value={formData.description}
                                onChange={handleChange}
                                rows="4"
                                className="w-full border-gray-300 border rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                            ></textarea>
                        </div>

                        <button
                            type="submit"
                            disabled={status === 'submitting'}
                            className={`w-full text-white font-bold py-3 rounded-md transition disabled:bg-gray-300 ${isService ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'
                                }`}
                        >
                            {status === 'submitting' ? 'Submitting...' : (isService ? 'Book Service' : 'Register Complaint')}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default Complaint;
