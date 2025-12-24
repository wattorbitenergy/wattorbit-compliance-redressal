import React from 'react';
import { Phone, MessageCircle, Map, UserCheck } from 'lucide-react';

const Support = () => {
    return (
        <div className="min-h-screen bg-gray-50 py-12">
            <div className="container mx-auto px-4">
                <h1 className="text-3xl font-bold text-center mb-12 text-blue-900">How can we help you?</h1>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                    {/* Online Support */}
                    <div className="bg-white p-8 rounded-lg shadow-sm">
                        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                            <MessageCircle className="text-blue-600" />
                            Online Support
                        </h2>
                        <div className="space-y-6">
                            <div className="flex items-start gap-4">
                                <div className="bg-blue-100 p-3 rounded-full">
                                    <Phone className="h-6 w-6 text-blue-600" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg">Call Us</h3>
                                    <p className="text-gray-600">+91 73790 92670</p>
                                    <p className="text-sm text-gray-500">Available Mon-Sat, 9AM - 6PM</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-4">
                                <div className="bg-green-100 p-3 rounded-full">
                                    <MessageCircle className="h-6 w-6 text-green-600" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg">WhatsApp Chat</h3>
                                    <p className="text-gray-600">Click to chat with our support team instantly.</p>
                                    <a href="https://wa.me/917379092670" target="_blank" rel="noreferrer" className="text-blue-600 font-medium hover:underline inline-block mt-1">Start Chat &rarr;</a>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Offline/Technician Support */}
                    <div className="bg-white p-8 rounded-lg shadow-sm border-2 border-yellow-500/20">
                        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                            <UserCheck className="text-yellow-600" />
                            Offline Technician
                        </h2>
                        <p className="text-gray-600 mb-6">
                            Need on-site assistance? Our certified technicians are available in select cities to visit your location.
                        </p>

                        <div className="bg-yellow-50 p-4 rounded-md border border-yellow-100 mb-6">
                            <h4 className="font-bold text-yellow-800 mb-2">Available Cities</h4>
                            <div className="flex flex-wrap gap-2">
                                <span className="bg-white px-3 py-1 rounded text-sm text-gray-700 shadow-sm">Lucknow</span>
                                <span className="bg-white px-3 py-1 rounded text-sm text-gray-700 shadow-sm">Delhi</span>
                                <span className="bg-white px-3 py-1 rounded text-sm text-gray-700 shadow-sm">Mumbai</span>
                                <span className="bg-white px-3 py-1 rounded text-sm text-gray-700 shadow-sm">Bangalore</span>
                            </div>
                        </div>

                        <button className="w-full bg-yellow-500 text-blue-900 font-bold py-3 rounded-md hover:bg-yellow-400 transition">
                            Find Technician Near Me
                        </button>
                    </div>
                </div>

                {/* FAQ Section */}
                <div className="mt-16 max-w-3xl mx-auto">
                    <h2 className="text-2xl font-bold mb-6 text-center">Frequently Asked Questions</h2>
                    <div className="space-y-4">
                        <div className="bg-white p-4 rounded shadow-sm">
                            <h3 className="font-bold mb-2">How long does it take to resolve a complaint?</h3>
                            <p className="text-gray-600 text-sm">Most online queries are resolved within 24 hours. On-site visits are scheduled based on technician availability, usually within 1-2 days.</p>
                        </div>
                        <div className="bg-white p-4 rounded shadow-sm">
                            <h3 className="font-bold mb-2">Is there a charge for technician visits?</h3>
                            <p className="text-gray-600 text-sm">Audit visits may be chargeable depending on your service plan. Please check with support for details.</p>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default Support;
