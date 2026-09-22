// Explicit operator action: this registers/updates only the named application command.
const id=process.env.DISCORD_CLIENT_ID,secret=process.env.DISCORD_CLIENT_SECRET;
if(!id||!secret)throw Error('DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET are required.');
const tokenResponse=await fetch('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:id,client_secret:secret,grant_type:'client_credentials',scope:'applications.commands.update'})});
if(!tokenResponse.ok)throw Error(`Client-credentials exchange returned ${tokenResponse.status}`);
const {access_token}=await tokenResponse.json();
const response=await fetch(`https://discord.com/api/v10/applications/${id}/commands`,{method:'POST',headers:{Authorization:`Bearer ${access_token}`,'Content-Type':'application/json'},body:JSON.stringify({name:'play-jev',description:'Play Guess Who against JEV',type:1,contexts:[0],integration_types:[0],options:[{type:3,name:'game',description:'Game to launch',required:true,choices:[{name:'Guess Who',value:'guess-who'}]}]})});
if(!response.ok)throw Error(`Command registration returned ${response.status}`);
console.log('Registered play-jev. Configure the interactions endpoint in your Discord application.');
