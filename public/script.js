<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ceelo Casino</title>
    <style>
        body { font-family: Arial, sans-serif; text-align: center; margin: 20px; }
        #login-form, #game, #room-selection { display: none; }
        #players p { margin: 5px; }
        #dice span { font-size: 24px; margin: 0 10px; }
        #chat-log, #public-chat-log { 
            height: 200px; 
            overflow-y: auto; 
            border: 1px solid #ccc; 
            padding: 10px; 
            margin: 10px auto; 
            text-align: left;
            max-width: 600px;
            background-color: #f9f9f9;
        }
        #chat-log div, #public-chat-log div { margin: 5px 0; }
        #chat-input, #public-chat-input { 
            width: 300px; 
            padding: 5px; 
            margin-right: 5px; 
        }
        #leave-room-btn { display: none; margin-top: 10px; }
        button { padding: 8px 16px; margin: 5px; }
        input, select { padding: 8px; margin: 5px; }
    </style>
</head>
<body>
    <div id="create-form">
        <h1>Create Account</h1>
        <input type="text" id="create-username" placeholder="Username">
