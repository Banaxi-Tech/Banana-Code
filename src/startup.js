import chalk from 'chalk';
import ora from 'ora';

export async function runStartup() {
    console.clear();
    const art = `                                                       #%%S#                                        
                                                      ?;+*??%                                       
                                                    #*;;;+%?#                                       
                                                  #?;:;+?S                                          
                                            #S%%?+;::;%                                             
                                         #?+::,,::;;*#                                              
                                       #*;::::,,,::*                                                
                                      %;;;::::,,,::#                                                
                                     ?;;;;::::::::*                                                 
                                    ?;;;;;::::::::#                                                 
                                   S;;;;;::::::::?                                                  
                                   *;;;;;:::::::;                                                   
                                  S;+;;;;:::::::?                                                   
                                  ?;;;;;::::::::#                                                   
                                  *;;;;;:::::::;                                                    
                                  +;;;;;:::::::;                                                    
                                  *;;;;;:::::::;                                                    
                                  ?;;;;;;:::::::#                                                   
                                  S;+;;;;::::::,?                                                   
                                   +;;;;;;::::::;                                                   
                                   ?;+;;;;::::::,*                                                  
                                    +;;;;;;:::::::%                                                 
                                    S;;;;;;::::::::%                                                
                                     %;;;;;;::::::::%                                               
                                      %;;;;;;;::::::,*                                              
                                       %;;;;;;;::::::,;S                                            
                                        #+;;;;;;::::::::+#                                          
                                          ?;;;;;;;::::::,:*#                                        
                                           S*;;;;;;;:::::::;%                                       
               #                             %;;;;;;;;:::::::*                                      
                                              #%*;;;;;;;::::::+#                                    
                         #S#      ##             S*+;;;;::::;;;+                                    
                                                   #S%*+;;;;;;*S                                    
                                             #S#SSSSSS%%%?%%%%S   `;
    console.log(chalk.yellow(art));
    console.log();
    console.log(chalk.bold.yellow("Hold on, peeling the code..."));

    const spinner = ora({
        text: "Initializing 🍌Banana Code...",
        color: 'yellow'
    }).start();

    await new Promise(resolve => setTimeout(resolve, 1500));
    spinner.stop();
}
