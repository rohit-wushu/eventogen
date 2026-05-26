import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(localStorage.getItem('token') || null);
    const [loading, setLoading] = useState(true);
    const [pendingInvite, setPendingInvite] = useState(null);

    const logout = () => {
        localStorage.removeItem('token');
        setToken(null);
        setUser(null);
    };

    useEffect(() => {
        const initAuth = async () => {
            if (token) {
                try {
                    const payload = JSON.parse(atob(token.split('.')[1]));
                    if (payload.exp * 1000 < Date.now()) {
                        logout();
                    } else {
                        setUser(payload);
                        // Fetch fresh data from server
                        try {
                            const res = await api.get('/auth/me');
                            if (res.data.user) {
                                setUser(res.data.user);
                                if (res.data.token) {
                                    localStorage.setItem('token', res.data.token);
                                    setToken(res.data.token);
                                }
                            } else {
                                setUser(res.data);
                            }
                        } catch (err) {
                            console.error('Failed to fetch fresh user data:', err);
                        }
                    }
                } catch {
                    logout();
                }
            }
            setLoading(false);
        };
        initAuth();
    }, [token]);

    const login = (tokenStr, userData, invite = null) => {
        localStorage.setItem('token', tokenStr);
        setToken(tokenStr);
        setUser(userData);
        setPendingInvite(invite);
    };

    const updateAuth = (tokenStr, userData) => {
        localStorage.setItem('token', tokenStr);
        setToken(tokenStr);
        setUser(userData);
    };

    const clearInvite = () => setPendingInvite(null);

    return (
        <AuthContext.Provider value={{ user, token, login, logout, loading, pendingInvite, setPendingInvite, clearInvite, updateAuth, setUser }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
