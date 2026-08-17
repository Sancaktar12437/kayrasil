const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Supabase Bağlantısı
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://veututgtyznxlfyuaivw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_Dc5lPSWWQwDVm0f8jPJZYQ_h8y3YrR6';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Rastgele Davet Kodu Üretici
function generateInviteCode() {
    return 'LOVE-' + Math.random().toString(36).substring(2, 7).toUpperCase();
}

// KAYIT VEYA GİRİŞ APISI
app.post('/api/auth', async (req, res) => {
    const { username, password, authProvider } = req.body;

    if (!username || !password || !authProvider) {
        return res.status(400).json({ error: 'Tüm alanları doldurun.' });
    }

    // Kullanıcı kontrolü
    const { data: existingUser } = await supabase
        .from('profiles')
        .select('*')
        .eq('username', username)
        .single();

    if (existingUser) {
        // Giriş Yap (Düz metin şifre kontrolü)
        if (existingUser.auth_provider !== authProvider) {
            return res.status(400).json({ error: `Bu hesap ${existingUser.auth_provider} ile kayıtlı!` });
        }
        if (existingUser.password_hash !== password) {
            return res.status(400).json({ error: 'Hatalı şifre.' });
        }
        return res.json({ status: 'success', user: existingUser });
    } else {
        // Otomatik Kayıt Oluştur (Şifre gizlenmeden doğrudan kaydedilir)
        const inviteCode = generateInviteCode();

        const { data: newUser, error } = await supabase
            .from('profiles')
            .insert([{
                username,
                password_hash: password, // Şifre olduğu gibi yazılır
                auth_provider: authProvider,
                invite_code: inviteCode
            }])
            .select()
            .single();

        if (error) return res.status(500).json({ error: error.message });
        return res.json({ status: 'registered', user: newUser });
    }
});

// EŞLEŞME APISI
app.post('/api/pair', async (req, res) => {
    const { userId, inviteCode } = req.body;

    const { data: partner } = await supabase
        .from('profiles')
        .select('*')
        .eq('invite_code', inviteCode)
        .single();

    if (!partner) return res.status(404).json({ error: 'Geçersiz eşleşme kodu.' });
    if (partner.id === userId) return res.status(400).json({ error: 'Kendi kodunuzu giremezsiniz.' });

    await supabase.from('profiles').update({ partner_id: partner.id }).eq('id', userId);
    await supabase.from('profiles').update({ partner_id: userId }).eq('id', partner.id);

    res.json({ status: 'paired', partnerName: partner.username });
});

// MESAJLARI GETİR
app.get('/api/messages/:userId/:partnerId', async (req, res) => {
    const { userId, partnerId } = req.params;
    const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.${userId},receiver_id.${partnerId}),and(sender_id.${partnerId},receiver_id.${userId})`)
        .order('created_at', { ascending: true });

    res.json(msgs || []);
});

// SOCKET.IO ANLIK MESAJLAŞMA
io.on('connection', (socket) => {
    socket.on('join_chat', (userId) => {
        socket.join(userId);
    });

    socket.on('send_message', async (data) => {
        const { senderId, receiverId, content } = data;

        const { data: newMsg } = await supabase
            .from('messages')
            .insert([{ sender_id: senderId, receiver_id: receiverId, content }])
            .select()
            .single();

        io.to(senderId).to(receiverId).emit('receive_message', newMsg);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu ${PORT} limanında aktif!`));
