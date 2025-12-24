import React from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, ShieldCheck, LifeBuoy } from 'lucide-react';

const Home = () => {
    return (
        <div className="min-h-screen bg-gray-50">
            {/* Hero Section */}
            <section className="bg-blue-900 text-white py-20">
                <div className="container mx-auto px-4 text-center">
                    <h1 className="text-4xl md:text-5xl font-bold mb-6">WattOrbit Service & Support System</h1>
                    <p className="text-lg md:text-xl text-blue-100 mb-8 max-w-2xl mx-auto">
                        Resolving your energy infrastructure issues with speed and precision.
                        Connect with certified technicians online or offline in your city.
                    </p>
                    <div className="flex flex-col sm:flex-row justify-center gap-4">
                        <Link to="/complaint" className="bg-yellow-500 text-blue-900 px-8 py-3 rounded-md font-bold hover:bg-yellow-400 transition">
                            Register Complaint
                        </Link>
                        <Link to="/complaint?type=service" className="bg-green-500 text-white px-8 py-3 rounded-md font-bold hover:bg-green-400 transition">
                            Service Request
                        </Link>
                        <Link to="/support" className="bg-transparent border border-white px-8 py-3 rounded-md font-bold hover:bg-white hover:text-blue-900 transition">
                            Get Support
                        </Link>
                    </div>
                </div>
            </section>

            {/* Features Grid */}
            <section className="py-16">
                <div className="container mx-auto px-4">
                    <h2 className="text-3xl font-bold text-center text-gray-800 mb-12">Our Services</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {/* Feature 1 */}
                        <div className="bg-white p-8 rounded-lg shadow-sm hover:shadow-md transition text-center border-t-4 border-blue-600">
                            <ClipboardList className="h-12 w-12 text-blue-600 mx-auto mb-4" />
                            <h3 className="text-xl font-bold mb-3">Easy Complaint Registration</h3>
                            <p className="text-gray-600">
                                Log your technical grievances instantly directly through our web or app portal.
                            </p>
                        </div>

                        {/* Feature 2 */}
                        <div className="bg-white p-8 rounded-lg shadow-sm hover:shadow-md transition text-center border-t-4 border-yellow-500">
                            <ShieldCheck className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
                            <h3 className="text-xl font-bold mb-3">City-Wide Coverage</h3>
                            <p className="text-gray-600">
                                Authorized offline technicians available across multiple cities for on-site resolution.
                            </p>
                        </div>

                        {/* Feature 3 */}
                        <div className="bg-white p-8 rounded-lg shadow-sm hover:shadow-md transition text-center border-t-4 border-green-500">
                            <LifeBuoy className="h-12 w-12 text-green-500 mx-auto mb-4" />
                            <h3 className="text-xl font-bold mb-3">Online & Offline Support</h3>
                            <p className="text-gray-600">
                                Get immediate guidance via chat/call or schedule a visit from an expert.
                            </p>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default Home;
