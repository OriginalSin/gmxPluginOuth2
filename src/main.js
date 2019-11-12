import App from './App.svelte';
// import Requests from './worker/Requests.js';

import Oidc from 'oidc-client';
// import App from './App.svelte';

//const app = new App({target: document.body});

// app.$on('login', () => {
    // login();
// });

// app.$on('logout', () => {
    // logout();
// });

// app.$on('mvc', async () => {
    // const response = await mvc_api();
    // console.log(response);
// });

var authIP = '192.168.7.201';
if (location.search.indexOf('local')) { authIP = 'localhost'; }
var config = {
    authority: 'https://' + authIP + ':5001',
    client_id: "spa",
    redirect_uri: "https://localhost:8030/callback.html",
    response_type: "code",
    scope:"openid profile email api1",
    post_logout_redirect_uri : "https://localhost:8030/index.html",
};

var mgr = new Oidc.UserManager(config);

mgr.getUser().then(function (user) {
console.log('sssssss', user);
    if (user) {
        app.$set({'loggedIn': true, 'userInfo': {name: user.profile.name}});
    }    
});

function login() {
    mgr.signinRedirect();
}
    mgr.signinRedirect();

function mvc_api() {
    return api ('https://' + authIP + ':5002/weatherforecast');
}
// mvc_api();

function api(url) {
    return new Promise ((resolve, reject) => {
        mgr.getUser().then (user => {            
            let xhr = new XMLHttpRequest();
            xhr.open("GET", url);
            xhr.onload = function () {                
                if (xhr.status === 200) {
                    resolve(JSON.parse (xhr.responseText));
                }
                else {
                    reject(xhr);
                }
            }
            xhr.setRequestHeader("Authorization", "Bearer " + user.access_token);
            xhr.send();
        });        
    });    
}

function logout() {
    mgr.signoutRedirect();
}


export {
    App
};
