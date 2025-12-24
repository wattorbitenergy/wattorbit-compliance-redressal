import React from 'react';
import { Phone, Mail, MapPin } from 'lucide-react';

const Footer = () => {
    return (
        <footer className="bg-gray-900 text-white pt-12 pb-6">
            <div className="container mx-auto px-4 grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
                <div>
                    <h3 className="text-xl font-bold mb-4">WattOrbit Energy</h3>
                    <p className="text-gray-400 text-sm leading-relaxed">
                        WattOrbit Energy Solution LLP<br />
                        Expert compliance and redressal mechanism for your peace of mind.
                    </p>
                    <a href="https://wattorbit.in" target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 mt-2 inline-block text-sm">Visit wattorbit.in</a>
                </div>

                <div>
                    <h3 className="text-xl font-bold mb-4">Quick Links</h3>
                    <ul className="space-y-2 text-gray-400 text-sm">
                        <li><a href="#" className="hover:text-white">About Us</a></li>
                        <li><a href="#" className="hover:text-white">Services</a></li>
                        <li><a href="#" className="hover:text-white">Privacy Policy</a></li>
                        <li><a href="#" className="hover:text-white">Terms & Conditions</a></li>
                    </ul>
                </div>

                <div>
                    <h3 className="text-xl font-bold mb-4">Contact Us</h3>
                    <ul className="space-y-4 text-gray-400 text-sm">
                        <li className="flex items-start gap-3">
                            <MapPin className="h-5 w-5 text-blue-500 mt-0.5" />
                            <span>Indaurabag, Bakshi Ka Talab, Lucknow - 226202</span>
                        </li>
                        <li className="flex items-center gap-3">
                            <Phone className="h-5 w-5 text-blue-500" />
                            <span>+91 73790 92670</span>
                        </li>
                        <li className="flex items-center gap-3">
                            <Mail className="h-5 w-5 text-blue-500" />
                            <span>support@wattorbit.in</span>
                        </li>
                    </ul>
                </div>
            </div>
            <div className="border-t border-gray-800 pt-6 text-center text-gray-500 text-sm">
                © {new Date().getFullYear()} WattOrbit Energy Solution LLP. All rights reserved.
            </div>
        </footer>
    );
};

export default Footer;
