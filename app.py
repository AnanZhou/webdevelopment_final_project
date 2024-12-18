import string
import random
import time
from datetime import datetime
from flask import Flask, g,request, jsonify,render_template
from functools import wraps
import sqlite3

app = Flask(__name__)
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0


def get_db():
    db = getattr(g, '_database', None)

    if db is None:
        db = g._database = sqlite3.connect('db/watchparty.sqlite3')
        db.row_factory = sqlite3.Row
        setattr(g, '_database', db)
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def query_db(query, args=(), one=False):
    db = get_db()
    cursor = db.execute(query, args)
    rows = cursor.fetchall()
    db.commit()
    cursor.close()
    if rows:
        if one: 
            return rows[0]
        return rows
    return None

def new_user():
    username = "Unnamed User #" + ''.join(random.choices(string.digits, k=6))
    password = ''.join(random.choices(string.ascii_lowercase + string.digits, k=10))
    api_key = ''.join(random.choices(string.ascii_lowercase + string.digits, k=40))
    
    try:
        # Insert the new user into the database
        query = '''
        INSERT INTO users (username, password, api_key)
        VALUES (?, ?, ?)
        '''
        query_db(query, (username, password, api_key))
        return {
            "username": username,
            "password": password,
            "api_key": api_key
        }
    except sqlite3.IntegrityError as e:
        # Handle UNIQUE constraint violation or other database issues
        return {"error": str(e)}

# User authentication based on API key
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Get the API key from the request headers
        api_key = request.headers.get('Authorization')
        
        # Check if the API key is provided and starts with 'Bearer '
        if api_key and api_key.startswith("Bearer "):
            # Remove "Bearer " prefix to get the actual API key
            api_key = api_key.split(" ", 1)[1]
        else:
            return jsonify({"error": "Login required"}), 403

        # Check if the API key exists in the database
        user = query_db('SELECT * FROM users WHERE api_key = ?', (api_key,), one=True)
        if user is None:
            return jsonify({"error": "Invalid API key"}), 403
        
        # Set g.user for access in view functions
        g.user = user
        return f(*args, **kwargs)
    
    return decorated_function

##########################################################################
# TODO: If your app sends users to any other routes, include them here.
#       (This should not be necessary).
@app.route('/')
@app.route('/profile')
@app.route('/signup')
@app.route('/login')
@app.route('/channels')
@app.route('/channels/<int:channel_id>')
@app.route('/messages/<int:message_id>')
def index():
    return app.send_static_file('index.html')

##########################################################################


### Auth endpoints(everyone can access these two API)
@app.route('/api/signup', methods=['POST'])
def signup():
    user = new_user()  # Call the new_user function to create the user
    if user:  # Ensure user creation was successful
        return jsonify({
            "message": "User created",
            "name": user['username'],
            "password": user['password'],
            "api_key": user['api_key']
        })
    else:
        return jsonify({"error": "Failed to create user"}), 500

@app.route('/api/login', methods =['POST'])
def login():
    name = request.json.get('username')
    password = request.json.get('password')
    user = query_db('SELECT * FROM users WHERE username = ? AND password = ?', (name, password), one=True)
    if user:
        return jsonify({"message": "Login successful", "user_id": user['id'], "api_key": user['api_key']})
    return jsonify({"error": "Invalid credentials"}), 401

## need authentication

# update username
@app.route('/api/user/name', methods=['POST'])
@login_required
def update_username():
    new_name = request.json.get('username')
    if not new_name:
        return jsonify({"error": "Username is required"}), 400

    # Check if the username already exists
    existing_user = query_db('SELECT id FROM users WHERE username = ?', [new_name], one=True)
    if existing_user:
        return jsonify({"error": "Username already exists"}), 400

    # Update the username if no conflicts
    query_db('UPDATE users SET username = ? WHERE id = ?', [new_name, g.user['id']])
    return jsonify({"message": "Username updated successfully"})


#update password
@app.route('/api/user/password', methods=['POST'])
@login_required
def update_password():
    new_password = request.json.get('password')
    if not new_password:
        return jsonify({"error": "Password is required"}), 400

    query_db('UPDATE users SET password = ? WHERE id = ?', [new_password, g.user['id']])
    return jsonify({"message": "Password updated successfully"})

# log out
@app.route('/api/logout', methods=['POST'])
@login_required
def logout():
    conn = get_db()
    conn.execute("UPDATE users SET api_key=NULL WHERE id=?", (g.user['id'],))
    conn.commit()
    return jsonify({"success":True})

## channel endpoints
@app.route('/api/channels', methods=['POST'])
@login_required
def create_channel():
    data = request.json
    name = data.get('name')
    if not name:
        return jsonify({"error": "Channel name is required"}), 400

    conn = get_db()

    # Check if the channel already exists
    existing_channel = conn.execute("SELECT id FROM channels WHERE name = ?", (name,)).fetchone()
    if existing_channel:
        return jsonify({"error": "Channel already exists"}), 400

    # Insert the new channel
    try:
        conn.execute("INSERT INTO channels (name) VALUES (?)", (name,))
        conn.commit()
        c = conn.execute("SELECT * FROM channels WHERE name = ?", (name,)).fetchone()
        return jsonify({"id": c['id'], "name": c['name']})
    except sqlite3.Error as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/channels', methods=['GET'])
@login_required
def list_channels():
    conn = get_db()
    # Get all channels
    channels = conn.execute("SELECT * FROM channels").fetchall()

    # Compute unread counts
    # unread_count = total messages after user's last_read_message_id
    # If no entry in reads table, all messages in channel are unread
    result = []
    for c in channels:
        read = conn.execute("SELECT last_read_message_id FROM reads WHERE user_id=? AND channel_id=?", (g.user['id'], c['id'])).fetchone()
        last_read = read['last_read_message_id'] if read else 0
        unread_count = conn.execute("SELECT COUNT(*) as cnt FROM messages WHERE channel_id=? AND id>? AND parent_id IS NULL", (c['id'], last_read)).fetchone()['cnt']
        result.append({
            "id": c['id'],
            "name": c['name'],
            "unread_count": unread_count
        })
    return jsonify(result)

## message endpoint

@app.route('/api/channels/<int:channel_id>/messages', methods=['GET'])
@login_required
def get_channel_messages(channel_id):
    conn = get_db()
    # Get top-level messages only (parent_id IS NULL)
    msgs = conn.execute("""
        SELECT m.id, m.text, m.created_at, m.user_id, u.username,
               (SELECT COUNT(*) FROM messages WHERE parent_id=m.id) as replies_count
        FROM messages m
        JOIN users u ON u.id=m.user_id
        WHERE m.channel_id=? AND m.parent_id IS NULL
        ORDER BY m.created_at ASC
    """, (channel_id,)).fetchall()

    # For reactions, gather all message_ids and fetch reactions
    msg_ids = [m['id'] for m in msgs]
    reactions = {}
    if msg_ids:
        q_marks = ",".join(["?"]*len(msg_ids))
        r = conn.execute(f"""
            SELECT r.message_id, r.emoji, u.username
            FROM reactions r
            JOIN users u ON u.id=r.user_id
            WHERE r.message_id IN ({q_marks})
        """, msg_ids).fetchall()
        for row in r:
            mid = row['message_id']
            if mid not in reactions:
                reactions[mid] = {}
            if row['emoji'] not in reactions[mid]:
                reactions[mid][row['emoji']] = []
            reactions[mid][row['emoji']].append(row['username'])

    result = []
    for m in msgs:
        message_reactions = reactions.get(m['id'], {})
        # Convert {emoji: [users]} into a structure with counts
        reactions_obj = {emoji: len(users) for emoji, users in message_reactions.items()}

        result.append({
            "id": m['id'],
            "text": m['text'],
            "user_id": m['user_id'],
            "username": m['username'],
            "created_at": m['created_at'],
            "replies_count": m['replies_count'],
            "reactions": reactions_obj,
            "reactors_for_each_emoji": message_reactions
        })
    return jsonify(result)

@app.route('/api/channels/<int:channel_id>/messages', methods=['POST'])
@login_required
def post_message(channel_id):
    data = request.json
    text = data.get('text')
    parent_id = data.get('parent_id')
    if not text:
        return jsonify({"error":"Text required"}), 400
    conn = get_db()
    cursor=conn.execute("INSERT INTO messages (channel_id, user_id, text, parent_id) VALUES (?,?,?,?)",
                 (channel_id, g.user['id'], text, parent_id))
    conn.commit()
    mid = cursor.lastrowid
    m = conn.execute("SELECT m.id, m.text, m.created_at, u.username FROM messages m JOIN users u ON u.id=m.user_id WHERE m.id=?", (mid,)).fetchone()
    return jsonify({"id": m['id'], "text": m['text'], "created_at": m['created_at'], "username": m['username']})


### REPLIES ENDPOINT ###

@app.route('/api/messages/<int:message_id>/replies', methods=['GET'])
@login_required
def get_replies(message_id):
    conn = get_db()
    replies = conn.execute("""
        SELECT m.id, m.text, m.created_at, m.user_id, u.username
        FROM messages m
        JOIN users u ON u.id=m.user_id
        WHERE m.parent_id=? ORDER BY m.created_at ASC
    """, (message_id,)).fetchall()

    # Fetch reactions for replies similarly
    r_ids = [r['id'] for r in replies]
    reactions = {}
    if r_ids:
        q_marks = ",".join(["?"]*len(r_ids))
        rr = conn.execute(f"""
            SELECT r.message_id, r.emoji, u.username
            FROM reactions r
            JOIN users u ON u.id=r.user_id
            WHERE r.message_id IN ({q_marks})
        """, r_ids).fetchall()
        for row in rr:
            mid = row['message_id']
            if mid not in reactions:
                reactions[mid] = {}
            if row['emoji'] not in reactions[mid]:
                reactions[mid][row['emoji']] = []
            reactions[mid][row['emoji']].append(row['username'])

    result = []
    for rep in replies:
        message_reactions = reactions.get(rep['id'], {})
        reactions_obj = {emoji: len(users) for emoji, users in message_reactions.items()}
        result.append({
            "id": rep['id'],
            "text": rep['text'],
            "user_id": rep['user_id'],
            "username": rep['username'],
            "created_at": rep['created_at'],
            "reactions": reactions_obj,
            "reactors_for_each_emoji": message_reactions
        })
    return jsonify(result)


### REACTIONS ENDPOINT ###

@app.route('/api/messages/<int:message_id>/reactions', methods=['POST'])
@login_required
def add_reaction(message_id):
    data = request.json
    emoji = data.get('emoji')
    if not emoji:
        return jsonify({"error":"emoji required"}),400
    conn = get_db()
    # Prevent duplicates if desired; or allow multiple identical reactions.
    # Let's allow one reaction type per user/message combo.
    existing = conn.execute("SELECT * FROM reactions WHERE message_id=? AND user_id=? AND emoji=?", (message_id, g.user['id'], emoji)).fetchone()
    if existing:
        # If already reacted with this emoji, maybe remove it?
        # For simplicity, let's just return success.
        return jsonify({"success":True})
    conn.execute("INSERT INTO reactions (message_id, user_id, emoji) VALUES (?,?,?)", (message_id, g.user['id'], emoji))
    conn.commit()
    return jsonify({"success":True})


### READS ENDPOINT ###

@app.route('/api/channels/<int:channel_id>/read', methods=['POST'])
@login_required
def update_read(channel_id):
    data = request.json
    last_read_message_id = data.get('last_read_message_id')
    conn = get_db()
    # Upsert into reads
    existing = conn.execute("SELECT * FROM reads WHERE user_id=? AND channel_id=?", (g.user['id'], channel_id)).fetchone()
    if existing:
        conn.execute("UPDATE reads SET last_read_message_id=? WHERE id=?", (last_read_message_id, existing['id']))
    else:
        conn.execute("INSERT INTO reads (user_id, channel_id, last_read_message_id) VALUES (?,?,?)", (g.user['id'], channel_id, last_read_message_id))
    conn.commit()
    return jsonify({"success":True})


### UNREAD COUNTS ###

@app.route('/api/unread_counts', methods=['GET'])
@login_required
def unread_counts():
    conn = get_db()
    # Single query approach:
    # Get all channels and user's last_read for each, then count messages.
    # For efficiency, you might do a JOIN. For simplicity, let's do a quick approach:
    channels = conn.execute("SELECT id FROM channels").fetchall()
    result = []
    for c in channels:
        read = conn.execute("SELECT last_read_message_id FROM reads WHERE user_id=? AND channel_id=?", (g.user['id'], c['id'])).fetchone()
        last_read = read['last_read_message_id'] if read else 0
        unread_count = conn.execute("SELECT COUNT(*) as cnt FROM messages WHERE channel_id=? AND id>? AND parent_id IS NULL", (c['id'], last_read)).fetchone()['cnt']
        result.append({"channel_id": c['id'], "unread_count": unread_count})
    return jsonify({"channel_unreads": result})


if __name__ == '__main__':
    app.run(debug=True)


    
